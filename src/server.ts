import fastify, { type FastifyInstance } from 'fastify';
import { TallyManager } from './manager.js';
import { FacetCoordinator, type SystemStatusSnapshot } from './coordinator.js';
import {
  type TallyLightConfig,
  type TallyMode,
  type BrightnessLevel,
  type RGB,
  type LightSegment,
  type CameraCueDirection,
  TALLY_COLORS,
} from './types.js';

export interface ServerOptions {
  port?: number | undefined;
  host?: string | undefined;
  manager?: TallyManager | undefined;
  coordinator?: FacetCoordinator | undefined;
}

export function createServer(options?: ServerOptions | undefined): {
  app: FastifyInstance;
  manager: TallyManager;
  coordinator: FacetCoordinator;
  start: () => Promise<string>;
  stop: () => Promise<void>;
} {
  const app = fastify({ logger: false });
  const manager = options?.manager ?? new TallyManager();
  const coordinator = options?.coordinator ?? new FacetCoordinator(manager);
  const port = options?.port ?? 3200;
  const host = options?.host ?? '0.0.0.0';

  // 1. Health check
  app.get('/health', async () => {
    return { status: 'ok', service: 'pilight' };
  });

  // 2. Service status
  app.get('/api/v1/status', async () => {
    const devices = manager.getAllStates();
    return {
      status: 'ok',
      deviceCount: devices.length,
      uptimeSeconds: Math.floor(process.uptime()),
      devices,
    };
  });

  // 3. List all lights
  app.get('/api/v1/lights', async () => {
    return manager.getAllStates();
  });

  // 4. Register or update a light
  app.post<{ Body: TallyLightConfig }>('/api/v1/lights', async (request, reply) => {
    const config = request.body;
    if (!config || !config.id) {
      return reply.status(400).send({ error: 'Field "id" is required' });
    }
    const device = manager.registerDevice(config);
    return reply.status(201).send(device.getState());
  });

  // 5. Get a specific light
  app.get<{ Params: { id: string } }>('/api/v1/lights/:id', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }
    return device.getState();
  });

  // 6. Delete a light
  app.delete<{ Params: { id: string } }>('/api/v1/lights/:id', async (request, reply) => {
    const removed = manager.removeDevice(request.params.id);
    if (!removed) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }
    return { success: true };
  });

  // 7. Set light state (PGM / PRV / OFF / COLOR)
  app.post<{
    Params: { id: string };
    Body: { mode: TallyMode; rgb?: RGB | undefined };
  }>('/api/v1/lights/:id/state', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    const { mode, rgb } = request.body ?? {};
    if (!mode) {
      return reply.status(400).send({ error: 'Field "mode" is required' });
    }

    if (mode === 'pgm') {
      await device.setProgram();
    } else if (mode === 'prv') {
      await device.setPreview();
    } else if (mode === 'off') {
      await device.setOff();
    } else if (mode === 'color') {
      if (!rgb || rgb.length !== 3) {
        return reply.status(400).send({ error: 'RGB array [r, g, b] required for mode="color"' });
      }
      await device.setColor(rgb);
    } else {
      return reply.status(400).send({ error: `Unknown mode: ${mode}` });
    }

    return device.getState();
  });

  // 8. Stream 9-zone animation frame (over UDP)
  app.post<{
    Params: { id: string };
    Body: { zones: RGB[] };
  }>('/api/v1/lights/:id/animation/frame', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    const { zones } = request.body ?? {};
    if (!zones || !Array.isArray(zones) || zones.length !== 9) {
      return reply.status(400).send({ error: 'Field "zones" must be an array of exactly 9 RGB triplets' });
    }

    const bytesSent = await device.streamAnimationFrame(zones);
    return { success: true, bytesSent };
  });

  // 8b. Start moving rainbow animation (over UDP)
  app.post<{
    Params: { id: string };
    Body: { durationSec?: number | undefined; fps?: number | undefined };
  }>('/api/v1/lights/:id/animation/rainbow', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    const { durationSec, fps } = request.body ?? {};
    // Trigger in background if indefinite, or await if timed
    if (durationSec && durationSec > 0) {
      device.playRainbow({ durationSec, fps }).catch((err) => {
        console.error(`[animation:rainbow] Error on ${device.id}:`, err);
      });
      return { success: true, message: `Rainbow animation started for ${durationSec}s at ${fps ?? 20} FPS` };
    }

    // Indefinite
    device.playRainbow({ durationSec: 0, fps }).catch((err) => {
      console.error(`[animation:rainbow] Error on ${device.id}:`, err);
    });
    return { success: true, message: `Rainbow animation streaming indefinitely at ${fps ?? 20} FPS` };
  });

  // 8c. Stop animation
  app.post<{ Params: { id: string } }>('/api/v1/lights/:id/animation/stop', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    device.stopAnimation();
    return { success: true, state: device.getState() };
  });

  // 8d. Camera operator PTZ cue (pan-left, pan-right, zoom-in, zoom-out, operator-call)
  app.post<{
    Params: { id: string };
    Body: { direction: CameraCueDirection; durationMs?: number | undefined };
  }>('/api/v1/lights/:id/cue', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    const { direction, durationMs } = request.body ?? {};
    if (!direction || !['pan-left', 'pan-right', 'zoom-in', 'zoom-out', 'operator-call'].includes(direction)) {
      return reply.status(400).send({
        error: 'Field "direction" must be pan-left, pan-right, zoom-in, zoom-out, or operator-call',
      });
    }

    device.cueCamera(direction, durationMs ?? 2000).catch((err) => {
      console.error(`[cueCamera] Error on ${device.id}:`, err);
    });

    return { success: true, direction, durationMs: durationMs ?? 2000 };
  });

  // 8e. Configure free segments on a light
  app.post<{
    Params: { id: string };
    Body: { segments: LightSegment[] };
  }>('/api/v1/lights/:id/segments', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    const { segments } = request.body ?? {};
    if (!Array.isArray(segments)) {
      return reply.status(400).send({ error: 'Field "segments" must be an array' });
    }

    device.setSegments(segments);
    return { success: true, state: device.getState() };
  });

  // 8f. Update color of a single segment
  app.post<{
    Params: { id: string; segmentId: string };
    Body: { color: RGB };
  }>('/api/v1/lights/:id/segments/:segmentId', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    const { color } = request.body ?? {};
    if (!color || color.length !== 3) {
      return reply.status(400).send({ error: 'Field "color" must be an [R, G, B] array' });
    }

    try {
      await device.updateSegment(request.params.segmentId, color);
      return { success: true, state: device.getState() };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 8g. Ingest system telemetry (ATEM, YouTube, Matrox, Projectors, Atlona)
  app.post<{ Body: Partial<SystemStatusSnapshot> }>('/api/v1/telemetry', async (request) => {
    await coordinator.updateStatus(request.body ?? {});
    return { success: true, snapshot: coordinator.getSnapshot() };
  });

  app.get('/api/v1/telemetry', async () => {
    return coordinator.getSnapshot();
  });

  // 9. Trigger flash call
  app.post<{ Params: { id: string } }>('/api/v1/lights/:id/call', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    const res = await device.call();
    return { success: true, response: res };
  });

  // 10. Hold server data toggle
  app.post<{
    Params: { id: string };
    Body: { hold: boolean };
  }>('/api/v1/lights/:id/hold', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    const { hold } = request.body ?? {};
    if (typeof hold !== 'boolean') {
      return reply.status(400).send({ error: 'Field "hold" must be a boolean' });
    }

    const res = await device.setHoldData(hold);
    return { success: true, response: res, state: device.getState() };
  });

  // 11. Brightness level
  app.post<{
    Params: { id: string };
    Body: { level: BrightnessLevel };
  }>('/api/v1/lights/:id/brightness', async (request, reply) => {
    const device = manager.getDevice(request.params.id);
    if (!device) {
      return reply.status(404).send({ error: `Light "${request.params.id}" not found` });
    }

    const { level } = request.body ?? {};
    if (!level || !['LOW', 'MEDIUM', 'HIGH'].includes(level)) {
      return reply.status(400).send({ error: 'Field "level" must be LOW, MEDIUM, or HIGH' });
    }

    const res = await device.setBrightness(level);
    return { success: true, response: res, state: device.getState() };
  });

  // 12. Batch set states
  app.post<{
    Body: { states: Array<{ id: string; mode: TallyMode; rgb?: RGB | undefined }> };
  }>('/api/v1/batch', async (request, reply) => {
    const { states } = request.body ?? {};
    if (!Array.isArray(states)) {
      return reply.status(400).send({ error: 'Field "states" must be an array' });
    }

    await manager.setBatchStates(states);
    return { success: true, states: manager.getAllStates() };
  });

  // 13. Direct one-off UDP
  app.post<{
    Body: { ip: string; mode?: TallyMode | undefined; rgb?: RGB | undefined; port?: number | undefined };
  }>('/api/v1/direct/udp', async (request, reply) => {
    const { ip, mode, rgb, port } = request.body ?? {};
    if (!ip) {
      return reply.status(400).send({ error: 'Field "ip" is required' });
    }

    let targetRgb: RGB = [0, 0, 0];
    if (mode === 'pgm') targetRgb = [...TALLY_COLORS.pgm];
    else if (mode === 'prv') targetRgb = [...TALLY_COLORS.prv];
    else if (mode === 'off') targetRgb = [...TALLY_COLORS.off];
    else if (rgb && rgb.length === 3) targetRgb = rgb;

    const bytesSent = await manager.sendDirectUdp(ip, targetRgb, port);
    return { success: true, bytesSent, ip, rgb: targetRgb };
  });

  // 14. Direct one-off HTTP
  app.post<{
    Body: { ip: string; command: string; port?: number | undefined };
  }>('/api/v1/direct/http', async (request, reply) => {
    const { ip, command, port } = request.body ?? {};
    if (!ip || !command) {
      return reply.status(400).send({ error: 'Fields "ip" and "command" are required' });
    }

    try {
      const res = await manager.sendDirectHttp(ip, command, port);
      return { success: true, response: res };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 15. Server-Sent Events (SSE) stream
  app.get('/api/v1/events', (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    // Send initial snapshot
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(manager.getAllStates())}\n\n`);

    const onDeviceChange = (state: any) => {
      reply.raw.write(`event: change\ndata: ${JSON.stringify(state)}\n\n`);
    };

    manager.on('deviceChange', onDeviceChange);

    request.raw.on('close', () => {
      manager.off('deviceChange', onDeviceChange);
    });
  });

  return {
    app,
    manager,
    coordinator,
    start: async () => {
      const address = await app.listen({ port, host });
      console.log(`[pilight] Server listening on ${address}`);
      return address;
    },
    stop: async () => {
      coordinator.stopPiGatewayListener();
      await app.close();
      await manager.destroy();
    },
  };
}
