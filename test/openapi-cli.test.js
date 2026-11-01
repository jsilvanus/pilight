import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROUTES } from '../src/api.js';
import { operations, buildRequest, parseArgs, run } from '../cli/cli.mjs';

const spec = JSON.parse(await readFile(new URL('../openapi/openapi.json', import.meta.url), 'utf8'));

test('openapi describes exactly the served routes', () => {
  const fromSpec = operations(spec).map((o) => `${o.method} ${o.path} ${o.op.operationId}`).sort();
  const fromRoutes = ROUTES.map((r) => `${r.method} ${r.path} ${r.operationId}`).sort();
  assert.deepEqual(fromSpec, fromRoutes);
});

test('CLI builds the path and body from the spec', () => {
  const op = operations(spec).find((o) => o.command === 'set-light-manual');
  const req = buildRequest(op, 'http://pi:3300', parseArgs(['--id', 'cam 1']), { PILIGHT_API_KEY: 'k' }).url.href;
  assert.equal(req, 'http://pi:3300/api/v1/lights/cam%201/manual');
  assert.throws(() => buildRequest(op, 'http://pi', parseArgs([])), /missing --id/);
});

test('CLI help lists commands and an unknown command exits 2', async () => {
  const lines = [];
  assert.equal(await run(['help'], { out: (l) => lines.push(l), spec }), 0);
  assert.ok(lines.some((l) => l.includes('set-mode')));
  assert.equal(await run(['nope'], { out: () => {}, spec }), 2);
});
