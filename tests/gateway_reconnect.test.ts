import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { FacetCoordinator } from '../src/coordinator.js';
import { TallyManager } from '../src/manager.js';

test('PiLight keeps following the gateway after a clean end of the event stream', async () => {
  let connections = 0;
  const server = createServer((_req, res) => {
    connections += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(': hello\n\n'); // stream ends cleanly
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const coordinator = new FacetCoordinator(new TallyManager({ disableDiscovery: true }));
  try {
    coordinator.startPiGatewayListener(`http://127.0.0.1:${port}`);
    await new Promise((r) => setTimeout(r, 3600));
    assert.ok(connections >= 2, `expected a reconnect, got ${connections} connection(s)`);
  } finally {
    coordinator.stopPiGatewayListener();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('PiLight does not fail when the gateway is not there', async () => {
  const coordinator = new FacetCoordinator(new TallyManager({ disableDiscovery: true }));
  coordinator.startPiGatewayListener('http://127.0.0.1:1');
  await new Promise((r) => setTimeout(r, 300));
  coordinator.stopPiGatewayListener();
});
