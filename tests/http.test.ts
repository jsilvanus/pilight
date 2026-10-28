import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TallyMaHttpClient } from '../src/protocols/tallyma-http.js';

test('TallyMaHttpClient generates strictly case-sensitive endpoints', async () => {
  const requests: string[] = [];

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    requests.push(String(url));
    return new Response('OK', { status: 200 });
  }) as any;

  try {
    const client = new TallyMaHttpClient('192.168.1.70', 80);

    await client.setProgram();
    assert.equal(requests[0], 'http://192.168.1.70:80/PGM');

    await client.setPreview();
    assert.equal(requests[1], 'http://192.168.1.70:80/PRV');

    await client.setOff();
    assert.equal(requests[2], 'http://192.168.1.70:80/NONE');

    await client.setColorHex('FF00AA');
    assert.equal(requests[3], 'http://192.168.1.70:80/COLOR?HEX=FF00AA');

    await client.setColor(255, 128, 0);
    assert.equal(requests[4], 'http://192.168.1.70:80/COLOR?R=255&G=128&B=0');

    await client.call();
    assert.equal(requests[5], 'http://192.168.1.70:80/CALL');

    await client.setBrightness('HIGH');
    assert.equal(requests[6], 'http://192.168.1.70:80/HIGH');

    await client.setHoldData(true);
    assert.equal(requests[7], 'http://192.168.1.70:80/HOLDDATA?H=1');

    await client.setHoldData(false);
    assert.equal(requests[8], 'http://192.168.1.70:80/HOLDDATA?H=0');

    await client.setCloud(true);
    assert.equal(requests[9], 'http://192.168.1.70:80/CLOUD?C=1');

    await client.setCloudServer('broker.local', 1883);
    assert.equal(requests[10], 'http://192.168.1.70:80/SETCLOUDSERVER?SERVER=broker.local&PORT=1883');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
