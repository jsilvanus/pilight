import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLight } from '../src/core/light.js';
import { lookFor, normalizeLook, parseHexColor } from '../src/core/states.js';
import { effectiveState, makeReading } from '../src/core/reading.js';

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; }, setTimeout: () => ({}), clearTimeout: () => {} };
}

test('parseHexColor and normalizeLook accept the documented forms', () => {
  assert.deepEqual(parseHexColor('#ff8000'), [255, 128, 0]);
  assert.equal(parseHexColor('red'), null);
  assert.deepEqual(normalizeLook('blink:#00ff00'), { rgb: [0, 255, 0], blink: true });
  assert.deepEqual(normalizeLook({ rgb: [300, -5, 1], blink: 0 }), { rgb: [255, 0, 1], blink: false });
  assert.equal(normalizeLook('nope'), null);
});

test('lookFor uses the light override before the default', () => {
  assert.deepEqual(lookFor('PGM', {}).rgb, [255, 0, 0]);
  assert.deepEqual(lookFor('PGM', { PGM: '#123456' }).rgb, [0x12, 0x34, 0x56]);
});

test('effectiveState turns UNKNOWN after the reading ttl (deadman)', () => {
  const r = makeReading({ state: 'PGM', checkedAt: 0, ttlMs: 5000 });
  assert.equal(effectiveState(r, 0, 4000), 'PGM');
  assert.equal(effectiveState(r, 0, 6000), 'UNKNOWN');
});

test('createLight pushes readings to outputs and uses the reading look', async () => {
  const seen = [];
  let emit;
  const source = { subscribe(e) { emit = e; return () => {}; } };
  const output = { name: 'test', apply: (r, ctx) => { seen.push({ state: r.state, rgb: ctx.lookOf(r).rgb }); } };
  const light = createLight({ source, outputs: [output], clock: fakeClock() });
  light.start();
  assert.equal(seen.at(-1).state, 'UNKNOWN');
  emit({ state: 'MANUAL', look: { rgb: [1, 2, 3], blink: false } });
  assert.deepEqual(seen.at(-1), { state: 'MANUAL', rgb: [1, 2, 3] });
  emit({ state: 'LIVE' });
  assert.deepEqual(seen.at(-1), { state: 'LIVE', rgb: [255, 0, 0] });
  emit({ state: 'BOGUS' });
  assert.equal(seen.at(-1).state, 'LIVE');
  await light.stop();
});
