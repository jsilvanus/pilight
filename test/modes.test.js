import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingFor, isMode, MODES } from '../src/modes.js';

const now = 10_000;
const fresh = (data) => ({ data, lastOkAt: now });
const cam1 = { id: 'cam1', atemInput: 1, encoder: 'any' };

test('isMode knows the four modes', () => {
  assert.deepEqual(MODES, ['manual', 'atem', 'encoder', 'youtube']);
  assert.equal(isMode('auto'), false);
});

test('manual shows the hand-set look, dark when none', () => {
  const r = readingFor({ mode: 'manual', light: cam1, feeds: {}, manual: { rgb: [1, 1, 1], blink: true }, now, staleMs: 1000 });
  assert.equal(r.state, 'MANUAL');
  assert.deepEqual(r.look, { rgb: [1, 1, 1], blink: true });
  assert.deepEqual(readingFor({ mode: 'manual', light: cam1, feeds: {}, manual: null, now, staleMs: 1000 }).look.rgb, [0, 0, 0]);
});

test('atem: program is PGM, preview PRV, else OFF; disconnected is UNKNOWN', () => {
  const feeds = { atem: fresh({ connected: true, programInput: 1, previewInput: 2 }) };
  assert.equal(readingFor({ mode: 'atem', light: cam1, feeds, now, staleMs: 1000 }).state, 'PGM');
  assert.equal(readingFor({ mode: 'atem', light: { id: 'x', atemInput: 2 }, feeds, now, staleMs: 1000 }).state, 'PRV');
  assert.equal(readingFor({ mode: 'atem', light: { id: 'x', atemInput: 3 }, feeds, now, staleMs: 1000 }).state, 'OFF');
  const down = { atem: fresh({ connected: false }) };
  assert.equal(readingFor({ mode: 'atem', light: cam1, feeds: down, now, staleMs: 1000 }).state, 'UNKNOWN');
});

test('encoder: streaming is LIVE, the chosen encoder only when configured', () => {
  const feeds = { encoder: fresh({ connected: true, encoder1: { mode: 'NONE', state: 'DISABLED' }, encoder2: { mode: 'STREAM', state: 'STREAMING' } }) };
  assert.equal(readingFor({ mode: 'encoder', light: cam1, feeds, now, staleMs: 1000 }).state, 'LIVE');
  assert.equal(readingFor({ mode: 'encoder', light: { id: 'x', encoder: 'encoder1' }, feeds, now, staleMs: 1000 }).state, 'OFF');
});

test('youtube: live, offline, unknown map to LIVE, OFF, UNKNOWN', () => {
  const at = (state) => readingFor({ mode: 'youtube', light: cam1, feeds: { youtube: fresh({ state, detail: 'd' }) }, now, staleMs: 1000 }).state;
  assert.equal(at('live'), 'LIVE');
  assert.equal(at('offline'), 'OFF');
  assert.equal(at('unknown'), 'UNKNOWN');
});

test('a feed older than staleMs makes the auto modes UNKNOWN', () => {
  const feeds = { youtube: { data: { state: 'live' }, lastOkAt: 0 } };
  const r = readingFor({ mode: 'youtube', light: cam1, feeds, now: 5000, staleMs: 1000 });
  assert.equal(r.state, 'UNKNOWN');
  assert.match(r.detail, /no answer/);
});
