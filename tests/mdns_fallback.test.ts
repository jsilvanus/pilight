import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget } from '../src/cli.js';
import { resolveTargetConfig, TallyDevice } from '../src/devices/tally-device.js';
import { TallyMaHttpClient } from '../src/protocols/tallyma-http.js';

test('Target parsing defaults to mDNS with IP fallback', () => {
  assert.deepEqual(parseTarget('tally01'), { host: 'tally01.local', fallbackIp: '192.168.1.70' });
  assert.deepEqual(parseTarget('1'), { host: 'tally01.local', fallbackIp: '192.168.1.70' });
  assert.deepEqual(parseTarget('tally02'), { host: 'tally02.local', fallbackIp: '192.168.1.89' });
  assert.deepEqual(parseTarget('2'), { host: 'tally02.local', fallbackIp: '192.168.1.89' });
  assert.deepEqual(parseTarget('tally01.local'), { host: 'tally01.local', fallbackIp: '192.168.1.70' });
  assert.deepEqual(parseTarget('192.168.1.70'), { host: '192.168.1.70' });
});

test('Device resolution defaults to tallyXX.local with IP fallback', () => {
  const d1 = resolveTargetConfig({ id: 'tally01', name: 'Camera 1' });
  assert.equal(d1.host, 'tally01.local');
  assert.equal(d1.fallbackIp, '192.168.1.70');

  const d2 = resolveTargetConfig({ id: 'cam2', name: 'Camera 2' });
  assert.equal(d2.host, 'tally02.local');
  assert.equal(d2.fallbackIp, '192.168.1.89');
});

test('TallyMaHttpClient tries mDNS first, then transparently fails over to fallback IP', async () => {
  const attempts: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = String(url);
    attempts.push(urlStr);

    if (urlStr.includes('tally01.local')) {
      throw new Error('getaddrinfo ENOTFOUND tally01.local');
    }
    return new Response('OK FROM IP', { status: 200 });
  }) as any;

  try {
    const client = new TallyMaHttpClient('tally01.local', 80, {
      fallbackIp: '192.168.1.70',
    });

    const res = await client.setProgram();
    assert.equal(res.status, 200);
    assert.equal(res.text, 'OK FROM IP');

    // Should have tried tally01.local first, then 192.168.1.70
    assert.equal(attempts.length, 2);
    assert.ok(attempts[0]!.includes('tally01.local:80/PGM'));
    assert.ok(attempts[1]!.includes('192.168.1.70:80/PGM'));

    // Active host should now be the fallback IP
    assert.equal(client.getActiveHost(), '192.168.1.70');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
