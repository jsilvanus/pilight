import { EventEmitter } from 'node:events';
import { TallyManager } from './manager.js';
import {
  type RGB,
  type SegmentFacet,
  TALLY_COLORS,
} from './types.js';

export interface SystemStatusSnapshot {
  atem?: {
    programInput: number | null;
    previewInput: number | null;
  } | undefined;
  youtube?: {
    live: boolean;
    status?: string | undefined; // 'live' | 'buffering' | 'idle'
  } | undefined;
  matrox?: {
    encoder1Live: boolean;
    encoder2Live: boolean;
  } | undefined;
  atemStreamRecord?: {
    streaming: boolean;
    recording: boolean;
  } | undefined;
  projectors?: {
    projector1On: boolean;
    projector2On: boolean;
    warmingOrCooling?: boolean | undefined;
  } | undefined;
  atlona?: {
    output1Input?: number | undefined;
    output2Input?: number | undefined;
  } | undefined;
}

/**
 * Maps a facet and the current system telemetry snapshot to a color.
 */
export function evaluateFacetColor(facet: SegmentFacet, snapshot: SystemStatusSnapshot): RGB {
  switch (facet.type) {
    case 'atem-input': {
      if (snapshot.atem?.programInput === facet.input) return [...TALLY_COLORS.pgm];
      if (snapshot.atem?.previewInput === facet.input) return [...TALLY_COLORS.prv];
      return [...TALLY_COLORS.off];
    }
    case 'youtube-stream': {
      if (snapshot.youtube?.live) return [...TALLY_COLORS.pgm];
      if (snapshot.youtube?.status === 'buffering' || snapshot.youtube?.status === 'starting') {
        return [...TALLY_COLORS.amber];
      }
      return [...TALLY_COLORS.off];
    }
    case 'matrox-encoder': {
      const isLive = facet.encoder === 1 ? snapshot.matrox?.encoder1Live : snapshot.matrox?.encoder2Live;
      return isLive ? [...TALLY_COLORS.pgm] : [...TALLY_COLORS.off];
    }
    case 'atem-recording': {
      return snapshot.atemStreamRecord?.recording ? [...TALLY_COLORS.pgm] : [...TALLY_COLORS.off];
    }
    case 'atem-streaming': {
      return snapshot.atemStreamRecord?.streaming ? [...TALLY_COLORS.pgm] : [...TALLY_COLORS.off];
    }
    case 'projector': {
      const isOn = facet.projector === 1 ? snapshot.projectors?.projector1On : snapshot.projectors?.projector2On;
      if (isOn) return [...TALLY_COLORS.cyan];
      if (snapshot.projectors?.warmingOrCooling) return [...TALLY_COLORS.amber];
      return [...TALLY_COLORS.off];
    }
    case 'atlona-output': {
      const route = facet.output === 1 ? snapshot.atlona?.output1Input : snapshot.atlona?.output2Input;
      if (route === 1) return [...TALLY_COLORS.purple];
      if (route && route > 1) return [...TALLY_COLORS.electricBlue];
      return [...TALLY_COLORS.off];
    }
    case 'manual': {
      return facet.color ?? [...TALLY_COLORS.off];
    }
    default:
      return [...TALLY_COLORS.off];
  }
}

/**
 * Coordinates multi-facet status evaluation and syncs with PiGateway telemetry.
 */
export class FacetCoordinator extends EventEmitter {
  private manager: TallyManager;
  private currentSnapshot: SystemStatusSnapshot = {};
  private sseAbortController: AbortController | null = null;
  private pigatewayUrl?: string | undefined;

  constructor(manager: TallyManager, pigatewayUrl?: string) {
    super();
    this.manager = manager;
    this.pigatewayUrl = pigatewayUrl;
  }

  getSnapshot(): SystemStatusSnapshot {
    return { ...this.currentSnapshot };
  }

  /**
   * Updates part or all of the system status snapshot, immediately evaluating all affected lights.
   */
  async updateStatus(partial: Partial<SystemStatusSnapshot>): Promise<void> {
    this.currentSnapshot = {
      ...this.currentSnapshot,
      ...partial,
      atem: partial.atem !== undefined ? partial.atem : this.currentSnapshot.atem,
      youtube: partial.youtube !== undefined ? partial.youtube : this.currentSnapshot.youtube,
      matrox: partial.matrox !== undefined ? partial.matrox : this.currentSnapshot.matrox,
      atemStreamRecord:
        partial.atemStreamRecord !== undefined ? partial.atemStreamRecord : this.currentSnapshot.atemStreamRecord,
      projectors: partial.projectors !== undefined ? partial.projectors : this.currentSnapshot.projectors,
      atlona: partial.atlona !== undefined ? partial.atlona : this.currentSnapshot.atlona,
    };

    await this.evaluateAll();
    this.emit('snapshotChange', this.currentSnapshot);
  }

  /**
   * Evaluates all registered lights and updates their segments or solid states.
   */
  async evaluateAll(): Promise<void> {
    const devices = this.manager.getAllDevices();

    for (const dev of devices) {
      const state = dev.getState();
      const segments = state.segments;

      if (segments && segments.length > 0) {
        // Multi-segment device (over UDP)
        const updates: Array<{ segmentId: string; color: RGB }> = [];
        for (const seg of segments) {
          const color = evaluateFacetColor(seg.facet, this.currentSnapshot);
          updates.push({ segmentId: seg.id, color });
        }
        await dev.updateSegments(updates).catch((err) => {
          console.error(`[FacetCoordinator] Failed updating segments on ${dev.id}:`, err.message);
        });
      } else {
        // Standard single tally device: check if device ID or name maps to an input
        // e.g. "cam1" -> input 1, "tally02" -> input 2
        const m = dev.id.match(/^(?:cam|tally|light)?0*(\d+)$/i);
        if (m && m[1]) {
          const inputNum = parseInt(m[1], 10);
          if (this.currentSnapshot.atem) {
            const isPgm = this.currentSnapshot.atem.programInput === inputNum;
            const isPrv = this.currentSnapshot.atem.previewInput === inputNum;

            if (isPgm && state.mode !== 'pgm') {
              await dev.setProgram().catch(() => {});
            } else if (isPrv && !isPgm && state.mode !== 'prv') {
              await dev.setPreview().catch(() => {});
            } else if (!isPgm && !isPrv && state.mode !== 'off') {
              await dev.setOff().catch(() => {});
            }
          }
        }
      }
    }
  }

  /**
   * Connects to PiGateway Server-Sent Events (SSE) to automatically follow ATEM, encoder, and projector events.
   */
  startPiGatewayListener(pigatewayUrl: string = this.pigatewayUrl ?? 'http://127.0.0.1:3100'): void {
    this.stopPiGatewayListener();
    this.pigatewayUrl = pigatewayUrl;
    this.sseAbortController = new AbortController();

    const connectSse = async () => {
      const url = `${this.pigatewayUrl}/api/v1/events`;
      console.log(`[FacetCoordinator] Connecting to PiGateway SSE at ${url}...`);

      try {
        const fetchOptions: RequestInit = {
          headers: { Accept: 'text/event-stream' },
        };
        if (this.sseAbortController) {
          fetchOptions.signal = this.sseAbortController.signal;
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok || !response.body) {
          throw new Error(`SSE response failed with status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const block of lines) {
            const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;

            const jsonStr = dataLine.replace(/^data:\s*/, '');
            try {
              const event = JSON.parse(jsonStr);
              await this.handleGatewayEvent(event);
            } catch {
              // Ignore unparseable frames
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn(`[FacetCoordinator] PiGateway SSE disconnected (${err.message}). Retrying in 3s...`);
          setTimeout(connectSse, 3000);
        }
      }
    };

    connectSse();
  }

  private async handleGatewayEvent(event: any): Promise<void> {
    if (!event || typeof event !== 'object') return;

    if (event.type === 'atem' && event.data) {
      const data = event.data;
      await this.updateStatus({
        atem: {
          programInput: data.programInput ?? null,
          previewInput: data.previewInput ?? null,
        },
      });
    } else if (event.type === 'youtube' && event.data) {
      await this.updateStatus({
        youtube: {
          live: Boolean(event.data.live),
          status: event.data.status,
        },
      });
    } else if (event.type === 'matrix' && event.data?.routes) {
      await this.updateStatus({
        atlona: {
          output1Input: event.data.routes[1] ?? undefined,
          output2Input: event.data.routes[2] ?? undefined,
        },
      });
    }
  }

  stopPiGatewayListener(): void {
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }
  }
}
