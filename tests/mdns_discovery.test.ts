import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MdnsDiscoveryService, normalizeMdnsHostname } from '../src/discovery/mdns-discovery.js';
import { TallyManager } from '../src/manager.js';
import { createServer } from '../src/server.js';

test('normalizeMdnsHostname formats targets to standard .local domain', () => {
  assert.equal(normalizeMdnsHostname('tally01'), 'tally01.local');
  assert.equal(normalizeMdnsHostname('1'), 'tally01.local');
  assert.equal(normalizeMdnsHostname('2'), 'tally02.local');
  assert.equal(normalizeMdnsHostname('cam2'), 'tally02.local');
  assert.equal(normalizeMdnsHostname('tally03.local'), 'tally03.local');
});

test('MdnsDiscoveryService parses mDNS responses and tracks DHCP IP changes', () => {
  const service = new MdnsDiscoveryService({
    intervalMs: 0,
    enableOsLookup: false,
  });

  const discoveredEvents: any[] = [];
  const ipChangedEvents: any[] = [];

  service.on('discovered', (light) => discoveredEvents.push(light));
  service.on('ipChanged', (evt) => ipChangedEvents.push(evt));

  // 1. Simulate mDNS response for tally03 with DHCP IP 192.168.1.120
  (service as any).handleMdnsPacket({
    answers: [
      { name: 'tally03.local', type: 'A', data: '192.168.1.120' },
    ],
  });

  assert.equal(service.getResolvedIp('tally03.local'), '192.168.1.120');
  assert.equal(service.getResolvedIp('3'), '192.168.1.120');
  assert.equal(discoveredEvents.length, 1);
  assert.equal(discoveredEvents[0].id, 'tally03');
  assert.equal(discoveredEvents[0].ip, '192.168.1.120');

  // 2. Simulate DHCP lease change: tally03 gets 192.168.1.155
  (service as any).handleMdnsPacket({
    answers: [
      { name: 'tally03.local', type: 'A', data: '192.168.1.155' },
    ],
  });

  assert.equal(service.getResolvedIp('tally03.local'), '192.168.1.155');
  assert.equal(ipChangedEvents.length, 1);
  assert.equal(ipChangedEvents[0].previousIp, '192.168.1.120');
  assert.equal(ipChangedEvents[0].light.ip, '192.168.1.155');

  service.stop();
});

test('TallyManager automatically updates device fallback IP on mDNS discovery', async () => {
  const manager = new TallyManager({ disableDiscovery: true });
  const discovery = manager.getDiscovery();

  // Register device for tally03
  const dev = manager.registerDevice({
    id: 'tally03',
    name: 'Camera 3',
    host: 'tally03.local',
  });

  // Simulate discovery of tally03 with dynamic DHCP IP
  (discovery as any).handleMdnsPacket({
    answers: [
      { name: 'tally03.local', type: 'A', data: '192.168.1.200' },
    ],
  });

  // Trigger discovery listener manually since disableDiscovery was set for test isolation
  (manager as any).updateDeviceDiscoveredIp({
    id: 'tally03',
    hostname: 'tally03.local',
    ip: '192.168.1.200',
    lastSeen: new Date().toISOString(),
    discoveryMethod: 'mdns-multicast',
  });

  assert.equal(dev.getState().fallbackIp, '192.168.1.200');

  await manager.destroy();
});

test('Server discovery endpoints: GET /api/v1/discovery and POST /api/v1/discovery/scan', async () => {
  const manager = new TallyManager({ disableDiscovery: true });
  const { app } = createServer({ manager });

  // 1. GET /api/v1/discovery
  const getRes = await app.inject({
    method: 'GET',
    url: '/api/v1/discovery',
  });
  assert.equal(getRes.statusCode, 200);
  const getJson = getRes.json();
  assert.ok(Array.isArray(getJson.discovered));

  // 2. POST /api/v1/discovery/scan
  const scanRes = await app.inject({
    method: 'POST',
    url: '/api/v1/discovery/scan',
    payload: { waitMs: 50 },
  });
  assert.equal(scanRes.statusCode, 200);
  const scanJson = scanRes.json();
  assert.equal(scanJson.success, true);
  assert.ok(Array.isArray(scanJson.discovered));

  await manager.destroy();
  await app.close();
});
