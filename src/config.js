/**
 * Configuration: environment variables plus a lights file (JSON, see
 * config/lights.example.json). Invalid input throws ConfigError with the field named.
 */
import { readFileSync } from 'node:fs';
import { ENCODER_CHOICES, MODES } from './modes.js';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const OUTPUT_TYPES = ['tally-ma', 'webhook', 'console'];

function int(value, field, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${field} must be an integer ${min}..${max}`);
  return n;
}

export function parseOutput(spec, field) {
  if (!spec || typeof spec !== 'object') throw new ConfigError(`${field} must be an object`);
  if (!OUTPUT_TYPES.includes(spec.type)) throw new ConfigError(`${field}.type must be one of ${OUTPUT_TYPES.join(', ')}`);
  if (spec.type === 'tally-ma') {
    if (typeof spec.host !== 'string' || !spec.host) throw new ConfigError(`${field}.host is required`);
    return {
      type: 'tally-ma',
      host: spec.host,
      port: int(spec.port, `${field}.port`, { min: 1, max: 65535, fallback: 21324 }),
      tickMs: int(spec.tickMs, `${field}.tickMs`, { min: 100, max: 10000, fallback: 500 }),
      onClose: spec.onClose ?? 'unknown',
    };
  }
  if (spec.type === 'webhook') {
    let url;
    try { url = new URL(spec.url); } catch { throw new ConfigError(`${field}.url must be a URL`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new ConfigError(`${field}.url must be http or https`);
    return { type: 'webhook', url: url.href, headers: spec.headers ?? {} };
  }
  return { type: 'console' };
}

export function parseLights(list) {
  if (!Array.isArray(list)) throw new ConfigError('lights must be an array');
  const ids = new Set();
  return list.map((raw, i) => {
    const field = `lights[${i}]`;
    if (!raw || typeof raw !== 'object') throw new ConfigError(`${field} must be an object`);
    if (typeof raw.id !== 'string' || !ID.test(raw.id)) throw new ConfigError(`${field}.id must be lowercase letters, digits and dashes`);
    if (ids.has(raw.id)) throw new ConfigError(`duplicate light id ${raw.id}`);
    ids.add(raw.id);
    const encoder = raw.encoder ?? 'any';
    if (!ENCODER_CHOICES.includes(encoder)) throw new ConfigError(`${field}.encoder must be one of ${ENCODER_CHOICES.join(', ')}`);
    const outputs = Array.isArray(raw.outputs) ? raw.outputs.map((o, j) => parseOutput(o, `${field}.outputs[${j}]`)) : [];
    return {
      id: raw.id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
      atemInput: raw.atemInput == null ? null : int(raw.atemInput, `${field}.atemInput`, { min: 1, max: 40, fallback: null }),
      encoder,
      look: raw.look && typeof raw.look === 'object' ? raw.look : {},
      outputs,
    };
  });
}

export function loadConfig(env = process.env, read = (path) => readFileSync(path, 'utf8')) {
  const mode = env.PILIGHT_MODE ?? 'manual';
  if (!MODES.includes(mode)) throw new ConfigError(`PILIGHT_MODE must be one of ${MODES.join(', ')}`);
  const lightsPath = env.PILIGHT_LIGHTS ?? 'config/lights.json';
  let lightsJson;
  try {
    lightsJson = JSON.parse(read(lightsPath));
  } catch (err) {
    throw new ConfigError(`cannot read lights file ${lightsPath}: ${err.message}`);
  }
  const lights = parseLights(Array.isArray(lightsJson) ? lightsJson : lightsJson.lights);
  let gatewayUrl;
  try { gatewayUrl = new URL(env.PILIGHT_GATEWAY_URL ?? 'http://127.0.0.1:3100').href; } catch { throw new ConfigError('PILIGHT_GATEWAY_URL must be a URL'); }
  return {
    host: env.PILIGHT_HOST ?? '127.0.0.1',
    port: int(env.PILIGHT_PORT, 'PILIGHT_PORT', { min: 1, max: 65535, fallback: 3300 }),
    apiKey: env.PILIGHT_API_KEY?.trim() || undefined,
    mode,
    lights,
    gateway: {
      baseUrl: gatewayUrl,
      apiKey: env.PILIGHT_GATEWAY_API_KEY?.trim() || undefined,
      pollMs: int(env.PILIGHT_POLL_MS, 'PILIGHT_POLL_MS', { min: 500, max: 60000, fallback: 3000 }),
      timeoutMs: int(env.PILIGHT_GATEWAY_TIMEOUT_MS, 'PILIGHT_GATEWAY_TIMEOUT_MS', { min: 100, max: 30000, fallback: 3000 }),
    },
    staleMs: int(env.PILIGHT_STALE_MS, 'PILIGHT_STALE_MS', { min: 1000, max: 3600000, fallback: 15000 }),
  };
}
