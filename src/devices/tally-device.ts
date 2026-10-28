import { EventEmitter } from 'node:events';
import {
  type RGB,
  type TallyMode,
  type BrightnessLevel,
  type TallyLightConfig,
  type TallyLightState,
  type LightSegment,
  type CameraCueDirection,
  DEFAULT_TALLY_DEVICES,
  TALLY_COLORS,
} from '../types.js';
import { TallyMaUdpClient, TALLYMA_UDP_PORT } from '../protocols/tallyma-udp.js';
import { TallyMaHttpClient } from '../protocols/tallyma-http.js';
import { TallyMaCloudClient, modeToCloudState } from '../protocols/tallyma-cloud.js';

export function hsvToRgb(h: number, s: number, v: number): RGB {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Resolves the primary mDNS hostname and optional fallback IP from a configuration.
 */
export function resolveTargetConfig(config: TallyLightConfig): { host: string; fallbackIp?: string | undefined } {
  // 1. Explicit host provided
  if (config.host) {
    const fallbackIp = config.fallbackIp ?? (config.ip && config.ip !== config.host ? config.ip : undefined);
    return { host: config.host, fallbackIp };
  }

  // 2. Check well-known default table (e.g. tally01, tally02)
  const normId = config.id.toLowerCase();
  const known = DEFAULT_TALLY_DEVICES[normId];
  if (known) {
    const fallbackIp = config.fallbackIp ?? config.ip ?? known.fallbackIp;
    return { host: known.host, fallbackIp };
  }

  // 3. Match numeric pattern (e.g. "cam1" -> tally01.local, "2" -> tally02.local)
  const numMatch = normId.match(/^(?:cam|tally|light)?0*(\d+)$/i);
  if (numMatch && numMatch[1]) {
    const padNum = numMatch[1].padStart(2, '0');
    const knownKey = `tally${padNum}`;
    const mDnsHost = `tally${padNum}.local`;
    const fallbackIp = config.fallbackIp ?? config.ip ?? DEFAULT_TALLY_DEVICES[knownKey]?.fallbackIp;
    return { host: mDnsHost, fallbackIp };
  }

  // 4. If an IP or string was provided in config.ip
  if (config.ip) {
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(config.ip)) {
      return { host: `${config.id}.local`, fallbackIp: config.ip };
    }
    return { host: config.ip, fallbackIp: config.fallbackIp };
  }

  // 5. Default fallback to id.local
  return { host: `${config.id}.local`, fallbackIp: config.fallbackIp };
}

export class TallyDevice extends EventEmitter {
  readonly config: TallyLightConfig;
  readonly host: string;
  readonly fallbackIp?: string | undefined;

  private state: TallyLightState;
  private currentZones: RGB[];
  private segments: LightSegment[] = [];

  private httpClient: TallyMaHttpClient;
  private udpClient: TallyMaUdpClient;
  private cloudClient: TallyMaCloudClient | undefined;

  private activeAnimationTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  constructor(
    config: TallyLightConfig,
    clients?: {
      udp?: TallyMaUdpClient | undefined;
      cloud?: TallyMaCloudClient | undefined;
    }
  ) {
    super();

    const resolved = resolveTargetConfig(config);
    this.host = resolved.host;
    this.fallbackIp = resolved.fallbackIp;
    this.currentZones = Array.from({ length: 9 }, () => [...TALLY_COLORS.off]);

    this.config = {
      httpPort: 80,
      udpPort: TALLYMA_UDP_PORT,
      protocol: 'http', // HTTP is default for solid tally states
      ...config,
      host: this.host,
      fallbackIp: this.fallbackIp,
    };

    if (config.segments) {
      this.segments = [...config.segments];
    }

    this.state = {
      id: config.id,
      host: this.host,
      fallbackIp: this.fallbackIp,
      activeTarget: this.host,
      mode: 'off',
      rgb: [...TALLY_COLORS.off],
      zones: this.currentZones.map((z) => [...z] as RGB),
      segments: this.segments,
      isAnimating: false,
      lastUpdated: new Date().toISOString(),
      online: true,
    };

    this.httpClient = new TallyMaHttpClient(this.host, this.config.httpPort ?? 80, {
      fallbackIp: this.fallbackIp,
    });
    this.udpClient = clients?.udp ?? new TallyMaUdpClient();
    this.cloudClient = clients?.cloud;
  }

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  getState(): TallyLightState {
    return {
      ...this.state,
      activeTarget: this.httpClient.getActiveHost(),
      zones: this.currentZones.map((z) => [...z] as RGB),
      segments: [...this.segments],
    };
  }

  // =========================================================================
  // Standard Solid Tally States (via HTTP)
  // =========================================================================

  /**
   * Set Program (Live/Red) via HTTP.
   */
  async setProgram(): Promise<void> {
    this.stopAnimation();
    await this.applyState('pgm', [...TALLY_COLORS.pgm]);
  }

  /**
   * Set Preview (Cued/Green) via HTTP.
   */
  async setPreview(): Promise<void> {
    this.stopAnimation();
    await this.applyState('prv', [...TALLY_COLORS.prv]);
  }

  /**
   * Set Off (Dark/None) via HTTP.
   */
  async setOff(): Promise<void> {
    this.stopAnimation();
    await this.applyState('off', [...TALLY_COLORS.off]);
  }

  /**
   * Set custom uniform RGB color via HTTP.
   */
  async setColor(rgb: RGB): Promise<void> {
    this.stopAnimation();
    await this.applyState('color', [rgb[0], rgb[1], rgb[2]]);
  }

  /**
   * Send a flash call alert to operator/talent via HTTP (/CALL).
   */
  async call(): Promise<{ status: number; text: string }> {
    return this.httpClient.call();
  }

  /**
   * Set brightness level via HTTP (/LOW, /MEDIUM, /HIGH).
   */
  async setBrightness(level: BrightnessLevel): Promise<{ status: number; text: string }> {
    const res = await this.httpClient.setBrightness(level);
    this.state.brightness = level;
    this.state.activeTarget = this.httpClient.getActiveHost();
    this.state.lastUpdated = new Date().toISOString();
    this.emit('change', this.getState());
    return res;
  }

  /**
   * Toggle server data hold via HTTP (/HOLDDATA?H=1 or 0).
   */
  async setHoldData(hold: boolean): Promise<{ status: number; text: string }> {
    const res = await this.httpClient.setHoldData(hold);
    this.state.holdData = hold;
    this.state.activeTarget = this.httpClient.getActiveHost();
    this.state.lastUpdated = new Date().toISOString();
    this.emit('change', this.getState());
    return res;
  }

  /**
   * Configure cloud mode via HTTP (/CLOUD and /SETCLOUDSERVER).
   */
  async setCloud(enable: boolean, server?: string, port?: number): Promise<void> {
    if (server && port) {
      await this.httpClient.setCloudServer(server, port);
    }
    await this.httpClient.setCloud(enable);
    this.state.cloudMode = enable;
    this.state.activeTarget = this.httpClient.getActiveHost();
    this.state.lastUpdated = new Date().toISOString();
    this.emit('change', this.getState());
  }

  // =========================================================================
  // Free Segmenting of the 9 LEDs (over UDP)
  // =========================================================================

  /**
   * Define or replace the segment layout on this light.
   */
  setSegments(segments: LightSegment[]): void {
    this.segments = [...segments];
    this.state.segments = this.segments;
    this.state.lastUpdated = new Date().toISOString();
    this.emit('change', this.getState());
  }

  /**
   * Update the color of a specific configured segment, transmitting the 29-byte UDP packet.
   */
  async updateSegment(segmentId: string, color: RGB): Promise<void> {
    const seg = this.segments.find((s) => s.id === segmentId);
    if (!seg) {
      throw new Error(`Segment "${segmentId}" not configured on device "${this.id}"`);
    }

    for (const ledIdx of seg.leds) {
      if (ledIdx >= 0 && ledIdx < 9) {
        this.currentZones[ledIdx] = [...color];
      }
    }

    this.state.mode = 'segmented';
    this.state.lastUpdated = new Date().toISOString();
    await this.streamAnimationFrame(this.currentZones);
    this.emit('change', this.getState());
  }

  /**
   * Batch update multiple segments at once, sending a single 29-byte UDP packet.
   */
  async updateSegments(updates: Array<{ segmentId: string; color: RGB }>): Promise<void> {
    for (const u of updates) {
      const seg = this.segments.find((s) => s.id === u.segmentId);
      if (seg) {
        for (const ledIdx of seg.leds) {
          if (ledIdx >= 0 && ledIdx < 9) {
            this.currentZones[ledIdx] = [...u.color];
          }
        }
      }
    }

    this.state.mode = 'segmented';
    this.state.lastUpdated = new Date().toISOString();
    await this.streamAnimationFrame(this.currentZones);
    this.emit('change', this.getState());
  }

  // =========================================================================
  // Camera Director & PTZ Cueing (over UDP)
  // =========================================================================

  /**
   * Send a directional or operator PTZ cue to the camera operator via the LEDs.
   *
   * Assumptions regarding hardware:
   *  - LEDs 0 and 8 (1 and 9 in 1-based) correspond to operator/rear visibility.
   *  - LEDs 0..3 correspond to the left side; LEDs 5..8 correspond to the right side.
   *  - LED 4 is the center.
   *
   * The cue plays for durationMs and then automatically restores previous state.
   */
  async cueCamera(direction: CameraCueDirection, durationMs: number = 2000): Promise<void> {
    this.stopAnimation();

    const previousMode = this.state.mode;
    const previousRgb = [...this.state.rgb] as RGB;
    const previousZones = this.currentZones.map((z) => [...z] as RGB);

    this.state.isAnimating = true;
    this.state.lastUpdated = new Date().toISOString();
    this.emit('change', this.getState());

    const startTime = Date.now();
    const intervalMs = 60; // ~16 FPS animation loop

    return new Promise<void>((resolve) => {
      this.activeAnimationTimer = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        if (this.isDestroyed || !this.state.isAnimating || elapsed >= durationMs) {
          this.stopAnimation();

          // Restore baseline state
          if (previousMode === 'segmented') {
            this.currentZones = previousZones;
            await this.streamAnimationFrame(this.currentZones).catch(() => {});
          } else if (previousMode === 'pgm') {
            await this.setProgram().catch(() => {});
          } else if (previousMode === 'prv') {
            await this.setPreview().catch(() => {});
          } else if (previousMode === 'color') {
            await this.setColor(previousRgb).catch(() => {});
          } else {
            await this.setOff().catch(() => {});
          }

          resolve();
          return;
        }

        const step = Math.floor(elapsed / 150) % 4; // 150ms per animation cycle step
        const frame: RGB[] = Array.from({ length: 9 }, () => [0, 0, 0]);

        switch (direction) {
          case 'pan-left': {
            // Chase / light up leftward: LEDs 0, 1, 2, 3
            const leftLeds = [0, 1, 2, 3];
            const activeIdx = leftLeds[step % leftLeds.length]!;
            frame[activeIdx] = [...TALLY_COLORS.cyan];
            // Operator side flash
            frame[0] = step % 2 === 0 ? [...TALLY_COLORS.amber] : [0, 0, 0];
            break;
          }
          case 'pan-right': {
            // Chase / light up rightward: LEDs 5, 6, 7, 8
            const rightLeds = [5, 6, 7, 8];
            const activeIdx = rightLeds[step % rightLeds.length]!;
            frame[activeIdx] = [...TALLY_COLORS.cyan];
            // Operator side flash
            frame[8] = step % 2 === 0 ? [...TALLY_COLORS.amber] : [0, 0, 0];
            break;
          }
          case 'zoom-in': {
            // Expanding pulse: center (LED 4) -> outward (3,5) -> (2,6)
            if (step === 0) frame[4] = [...TALLY_COLORS.white];
            else if (step === 1) { frame[3] = [...TALLY_COLORS.cyan]; frame[5] = [...TALLY_COLORS.cyan]; }
            else if (step === 2) { frame[2] = [...TALLY_COLORS.cyan]; frame[6] = [...TALLY_COLORS.cyan]; }
            break;
          }
          case 'zoom-out': {
            // Contracting pulse: outward (1,7) -> (2,6) -> center (4)
            if (step === 0) { frame[1] = [...TALLY_COLORS.cyan]; frame[7] = [...TALLY_COLORS.cyan]; }
            else if (step === 1) { frame[3] = [...TALLY_COLORS.cyan]; frame[5] = [...TALLY_COLORS.cyan]; }
            else if (step === 2) frame[4] = [...TALLY_COLORS.white];
            break;
          }
          case 'operator-call': {
            // Flash rear LEDs 0 and 8 in Amber/White without distracting talent on front
            const col = step % 2 === 0 ? TALLY_COLORS.white : TALLY_COLORS.amber;
            frame[0] = [col[0], col[1], col[2]];
            frame[8] = [col[0], col[1], col[2]];
            break;
          }
        }

        try {
          await this.streamAnimationFrame(frame);
        } catch (err) {
          console.error(`[TallyDevice:${this.id}] Cue animation error:`, err);
        }
      }, intervalMs);
    });
  }

  // =========================================================================
  // UDP Frame Streaming & Animations
  // =========================================================================

  /**
   * Stream a single 29-byte UDP packet containing 9 RGB zones.
   */
  async streamAnimationFrame(zones: RGB[]): Promise<number> {
    return this.udpClient.send(this.host, zones, this.config.udpPort, this.fallbackIp);
  }

  /**
   * Play moving rainbow animation over UDP.
   */
  async playRainbow(options?: { durationSec?: number | undefined; fps?: number | undefined }): Promise<void> {
    this.stopAnimation();

    const fps = options?.fps ?? 20;
    const durationSec = options?.durationSec ?? 0;
    const intervalMs = Math.max(10, Math.round(1000 / fps));
    const startTime = Date.now();

    this.state.isAnimating = true;
    this.state.mode = 'animation';
    this.state.activeTarget = this.host;
    this.state.lastUpdated = new Date().toISOString();
    this.emit('change', this.getState());

    return new Promise<void>((resolve) => {
      this.activeAnimationTimer = setInterval(async () => {
        if (this.isDestroyed || !this.state.isAnimating) {
          this.stopAnimation();
          resolve();
          return;
        }

        const elapsedSec = (Date.now() - startTime) / 1000;
        if (durationSec > 0 && elapsedSec >= durationSec) {
          this.stopAnimation();
          resolve();
          return;
        }

        const offset = elapsedSec / 2.5;
        const zones: RGB[] = [];
        for (let i = 0; i < 9; i++) {
          const hue = (offset + i / 9) % 1.0;
          zones.push(hsvToRgb(hue, 1.0, 1.0));
        }

        try {
          await this.streamAnimationFrame(zones);
        } catch (err) {
          console.error(`[TallyDevice:${this.id}] UDP animation error:`, err);
        }
      }, intervalMs);
    });
  }

  /**
   * Stop active animation / cue loop.
   */
  stopAnimation(): void {
    if (this.activeAnimationTimer) {
      clearInterval(this.activeAnimationTimer);
      this.activeAnimationTimer = null;
    }
    if (this.state.isAnimating) {
      this.state.isAnimating = false;
      this.state.lastUpdated = new Date().toISOString();
      this.emit('change', this.getState());
    }
  }

  private async applyState(mode: TallyMode, rgb: RGB): Promise<void> {
    this.state.mode = mode;
    this.state.rgb = rgb;
    this.state.isAnimating = false;
    this.state.lastUpdated = new Date().toISOString();

    // Fill currentZones so zone inspect reflects solid color
    for (let i = 0; i < 9; i++) {
      this.currentZones[i] = [...rgb];
    }

    const protocol = this.config.protocol ?? 'http';

    // 1. HTTP: Default interface for solid tally commands
    if (protocol === 'http') {
      try {
        if (mode === 'pgm') {
          await this.httpClient.setProgram();
        } else if (mode === 'prv') {
          await this.httpClient.setPreview();
        } else if (mode === 'off') {
          await this.httpClient.setOff();
        } else if (mode === 'color') {
          await this.httpClient.setColor(rgb[0], rgb[1], rgb[2]);
        }
        this.state.activeTarget = this.httpClient.getActiveHost();
        this.state.online = true;
      } catch (err) {
        console.error(`[TallyDevice:${this.id}] HTTP command error:`, err);
        this.state.online = false;
      }
    }

    // 2. Cloud MQTT
    if ((protocol === 'cloud' || this.config.cloudTopic) && this.cloudClient) {
      const topic = this.config.cloudTopic ?? `tallyma/${this.id}/state`;
      try {
        const cloudState = modeToCloudState(mode);
        await this.cloudClient.publishState(topic, cloudState);
      } catch (err) {
        console.error(`[TallyDevice:${this.id}] Cloud publish error:`, err);
      }
    }

    // 3. UDP (if explicitly configured)
    if (protocol === 'udp') {
      try {
        await this.udpClient.send(this.host, rgb, this.config.udpPort, this.fallbackIp);
        this.state.online = true;
      } catch (err) {
        console.error(`[TallyDevice:${this.id}] UDP send error:`, err);
        this.state.online = false;
      }
    }

    this.emit('change', this.getState());
  }

  destroy(): void {
    this.isDestroyed = true;
    this.stopAnimation();
  }
}
