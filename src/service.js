/** Wires the hub, the gateway client and the HTTP API together. */
import http from 'node:http';
import { createHub } from './hub.js';
import { createGatewayClient } from './gateway/client.js';
import { createApi } from './api.js';

export function createService(config, { log = console, fetch, clock } = {}) {
  const onError = (err, info) => log.error?.(`pilight: ${info?.output ?? 'error'}: ${err.message}`);
  const hub = createHub({ lights: config.lights, mode: config.mode, staleMs: config.staleMs, clock, onError });
  const gateway = createGatewayClient({
    ...config.gateway,
    fetch,
    onFeed: (name, data) => hub.onFeed(name, data),
    onError: (err, name) => log.warn?.(`pilight: gateway ${name}: ${err.message}`),
  });
  const handle = createApi({ hub, apiKey: config.apiKey });
  const server = http.createServer((req, res) => { handle(req, res); });

  return {
    hub,
    gateway,
    server,
    async start() {
      hub.start();
      gateway.start();
      await new Promise((resolve) => server.listen(config.port, config.host, resolve));
      return server.address();
    },
    async stop() {
      gateway.stop();
      await hub.stop();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
