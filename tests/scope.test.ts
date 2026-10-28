import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TallyDevice } from '../src/devices/tally-device.js';
import { type RGB } from '../src/types.js';

test('Scope verification: HTTP is default for state changes; UDP is only used for animations', async () => {
  const httpRequests: string[] = [];
  const udpPackets: Array<{ ip: string; packetLength: number }> = [];

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    httpRequests.push(String(url));
    return new Response('OK', { status: 200 });
  }) as any;

  // Mock UDP client
  const mockUdpClient: any = {
    send: async (ip: string, input: any) => {
      udpPackets.push({ ip, packetLength: Array.isArray(input) ? input.length : 1 });
      return 29;
    },
    close: async () => {},
  };

  try {
    const device = new TallyDevice(
      {
        id: 'cam1',
        name: 'Camera 1',
        ip: '192.168.1.70',
      },
      { udp: mockUdpClient }
    );

    // 1. Verify default protocol is HTTP
    assert.equal(device.config.protocol, 'http');

    // 2. Setting Program -> must use HTTP (/PGM), NOT UDP
    await device.setProgram();
    assert.equal(httpRequests.length, 1);
    assert.equal(httpRequests[0], 'http://tally01.local:80/PGM');
    assert.equal(udpPackets.length, 0, 'UDP should NOT be sent for standard tally state');

    // 3. Setting Preview -> must use HTTP (/PRV), NOT UDP
    await device.setPreview();
    assert.equal(httpRequests.length, 2);
    assert.equal(httpRequests[1], 'http://tally01.local:80/PRV');
    assert.equal(udpPackets.length, 0, 'UDP should NOT be sent for standard tally state');

    // 4. Setting Off -> must use HTTP (/NONE), NOT UDP
    await device.setOff();
    assert.equal(httpRequests.length, 3);
    assert.equal(httpRequests[2], 'http://tally01.local:80/NONE');
    assert.equal(udpPackets.length, 0);

    // 5. Calling animation frame -> MUST use UDP, NOT HTTP
    const dummyZones: RGB[] = Array.from({ length: 9 }, () => [255, 0, 0]);
    await device.streamAnimationFrame(dummyZones);
    assert.equal(udpPackets.length, 1, 'UDP MUST be used for animation frame');
    assert.equal(udpPackets[0]!.ip, 'tally01.local');
    assert.equal(httpRequests.length, 3, 'HTTP should not be called for animation frame');

    device.destroy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
