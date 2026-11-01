import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorPacket, createTallyMaOutput } from '../src/outputs/tally-ma.js';
import { lookFor } from '../src/core/states.js';

test('colour packet is 29 bytes with nine RGB triplets', () => {
  const p = colorPacket([1, 2, 3]);
  assert.equal(p.length, 29);
  assert.deepEqual([...p.subarray(0, 5)], [2, 5, 1, 2, 3]);
});

test('output sends the look of the reading', async () => {
  const sent = [];
  const socket = { send: (buf, port, host, cb) => { sent.push({ buf, port, host }); cb(); }, close() {}, on() {}, unref() {} };
  const out = createTallyMaOutput({ host: 'lamp', socketFactory: () => socket, tickMs: 1e9 });
  const ctx = { lookOf: (r) => r.look ?? lookFor(r.state), lookFor: (s) => lookFor(s) };
  await out.apply({ state: 'MANUAL', look: { rgb: [9, 9, 9], blink: false }, checkedAt: 0, ttlMs: 60000 }, ctx);
  const colour = sent.at(-1);
  assert.equal(colour.host, 'lamp');
  assert.equal(colour.buf[2], 9);
  await out.close();
});
