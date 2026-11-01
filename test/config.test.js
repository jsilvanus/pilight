import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, parseLights, ConfigError } from '../src/config.js';

const lightsJson = JSON.stringify({ lights: [{ id: 'cam1', atemInput: 1, outputs: [{ type: 'tally-ma', host: '10.0.0.5' }] }] });

test('loadConfig defaults and reads the lights file', () => {
  const c = loadConfig({}, () => lightsJson);
  assert.equal(c.port, 3300);
  assert.equal(c.mode, 'manual');
  assert.equal(c.lights[0].outputs[0].port, 21324);
  assert.equal(c.gateway.baseUrl, 'http://127.0.0.1:3100/');
});

test('invalid settings name the field', () => {
  assert.throws(() => loadConfig({ PILIGHT_MODE: 'auto' }, () => lightsJson), /PILIGHT_MODE/);
  assert.throws(() => loadConfig({ PILIGHT_PORT: '99999' }, () => lightsJson), /PILIGHT_PORT/);
  assert.throws(() => loadConfig({}, () => { throw new Error('ENOENT'); }), ConfigError);
});

test('parseLights rejects duplicate ids and unknown outputs', () => {
  assert.throws(() => parseLights([{ id: 'a' }, { id: 'a' }]), /duplicate/);
  assert.throws(() => parseLights([{ id: 'a', outputs: [{ type: 'usb' }] }]), /type/);
  assert.throws(() => parseLights([{ id: 'Bad Id' }]), /id/);
});
