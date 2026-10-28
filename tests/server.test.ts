import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { TallyManager } from '../src/manager.js';

test('Server endpoints: health, registration, state, batch, and delete', async () => {
  const originalFetch = globalThis.fetch;
  const httpCalls: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request) => {
    httpCalls.push(String(url));
    return new Response('OK', { status: 200 });
  }) as any;

  try {
    const manager = new TallyManager();
    const { app } = createServer({ manager });

    // 1. Health
    const healthRes = await app.inject({
      method: 'GET',
      url: '/health',
    });
    assert.equal(healthRes.statusCode, 200);
    assert.deepEqual(healthRes.json(), { status: 'ok', service: 'pilight' });

    // 2. Register light
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/lights',
      payload: {
        id: 'cam1',
        name: 'Camera 1',
        ip: '192.168.1.70',
      },
    });
    assert.equal(regRes.statusCode, 201);
    const regBody = regRes.json();
    assert.equal(regBody.id, 'cam1');
    assert.equal(regBody.mode, 'off');

    // 3. Set state to PGM -> should call HTTP /PGM
    const stateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/lights/cam1/state',
      payload: { mode: 'pgm' },
    });
    assert.equal(stateRes.statusCode, 200);
    const stateBody = stateRes.json();
    assert.equal(stateBody.mode, 'pgm');
    assert.deepEqual(stateBody.rgb, [255, 0, 0]);
    assert.ok(httpCalls.some((c) => c.includes('/PGM')));

    // 4. Batch set states -> should call HTTP /PRV
    const batchRes = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        states: [
          { id: 'cam1', mode: 'prv' },
        ],
      },
    });
    assert.equal(batchRes.statusCode, 200);
    const cam1After = manager.getDevice('cam1');
    assert.equal(cam1After?.getState().mode, 'prv');
    assert.deepEqual(cam1After?.getState().rgb, [0, 255, 0]);
    assert.ok(httpCalls.some((c) => c.includes('/PRV')));

    // 5. Delete device
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/lights/cam1',
    });
    assert.equal(delRes.statusCode, 200);
    assert.equal(manager.getDevice('cam1'), undefined);

    await manager.destroy();
    await app.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
