import { createServer } from './server.js';
import { TallyManager } from './manager.js';
import { type TallyLightConfig } from './types.js';

const PORT = parseInt(process.env.PITALLY_PORT ?? '3107', 10);
const HOST = process.env.PITALLY_HOST ?? '0.0.0.0';
const CLOUD_BROKER = process.env.PITALLY_CLOUD_BROKER;

const manager = new TallyManager({
  cloudBrokerUrl: CLOUD_BROKER,
});

// Load initial devices from PITALLY_DEVICES environment variable if present
if (process.env.PITALLY_DEVICES) {
  try {
    const initialDevices: TallyLightConfig[] = JSON.parse(process.env.PITALLY_DEVICES);
    for (const dev of initialDevices) {
      manager.registerDevice(dev);
      console.log(`[pitally] Pre-registered device: ${dev.id} (${dev.ip})`);
    }
  } catch (err: any) {
    console.error('[pitally] Failed to parse PITALLY_DEVICES:', err.message);
  }
}

const server = createServer({
  port: PORT,
  host: HOST,
  manager,
});

if (process.env.PIGATEWAY_URL) {
  server.coordinator.startPiGatewayListener(process.env.PIGATEWAY_URL);
}

server.start().catch((err) => {
  console.error('[pitally] Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('[pitally] Shutting down...');
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
