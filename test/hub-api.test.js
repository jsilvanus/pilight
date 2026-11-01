import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';
import { createApi } from '../src/api.js';
import http from 'node:http';

const lights = [
  { id: 'cam1', name: 'Kamera 1', atemInput: 1, encoder: 'any', look: {}, outputs: [] },
  { id: 'cam2', name: 'Kamera 2', atemInput: 2, encoder: 'any', look: {}, outputs: [] },
];

function startServer(hub, apiKey) {
  const handle = createApi({ hub, apiKey });
  const server = http.createServer(handle);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('hub follows the ATEM tally and the mode switch', () => {
  const hub = createHub({ lights, mode: 'atem', makeOutput: () => ({ name: 'x', apply() {} }), tickMs: 1e9 });
  hub.start();
  hub.onFeed('atem', { connected: true, programInput: 1, previewInput: 2 });
  assert.equal(hub.light('cam1').state, 'PGM');
  assert.equal(hub.light('cam2').state, 'PRV');
  hub.setMode('manual');
  assert.equal(hub.light('cam1').state, 'MANUAL');
  hub.setManual('cam1', { rgb: [0, 0, 255], blink: false });
  assert.deepEqual(hub.light('cam1').rgb, [0, 0, 255]);
  hub.setManual('cam1', { rgb: [0, 0, 255], blink: false });
  hub.stop();
});

test('hub unknown light returns null', () => {
  const hub = createHub({ lights, makeOutput: () => ({ name: 'x', apply() {} }), tickMs: 1e9 });
  assert.equal(hub.setManual('nope', { rgb: [0, 0, 0], blink: false }), null);
});

test('API: reads are open, writes need the key, validation returns 422', async () => {
  const hub = createHub({ lights, makeOutput: () => ({ name: 'x', apply() {} }), tickMs: 1e9 });
  const server = await startServer(hub, 'secret');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/v1/lights`)).status, 200);
    const denied = await fetch(`${base}/api/v1/mode`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"mode":"atem"}' });
    assert.equal(denied.status, 401);
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer secret' };
    assert.equal((await fetch(`${base}/api/v1/mode`, { method: 'PUT', headers, body: '{"mode":"auto"}' })).status, 422);
    const ok = await fetch(`${base}/api/v1/lights/cam1/manual`, { method: 'PUT', headers, body: '{"color":"#ff8000","blink":true}' });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).rgb, [255, 128, 0]);
    assert.equal((await fetch(`${base}/api/v1/lights/cam1/manual`, { method: 'PUT', headers, body: '{"color":"blue"}' })).status, 422);
    assert.equal((await fetch(`${base}/api/v1/lights/none`)).status, 404);
  } finally {
    hub.stop();
    server.close();
  }
});
