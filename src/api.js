/**
 * HTTP API. Reads are open; writes need the API key (bearer token or X-Api-Key)
 * when one is configured. Routes are listed in ROUTES, which the OpenAPI test
 * compares with openapi/openapi.json.
 */
import { timingSafeEqual } from 'node:crypto';
import { MODES, isMode } from './modes.js';
import { parseHexColor } from './core/states.js';

export const ROUTES = Object.freeze([
  { operationId: 'getHealth', method: 'GET', path: '/health' },
  { operationId: 'getStatus', method: 'GET', path: '/api/v1/status' },
  { operationId: 'getMode', method: 'GET', path: '/api/v1/mode' },
  { operationId: 'setMode', method: 'PUT', path: '/api/v1/mode', write: true },
  { operationId: 'listLights', method: 'GET', path: '/api/v1/lights' },
  { operationId: 'getLight', method: 'GET', path: '/api/v1/lights/{id}' },
  { operationId: 'setLightManual', method: 'PUT', path: '/api/v1/lights/{id}/manual', write: true },
]);

const MAX_BODY = 16 * 1024;

function compile(route) {
  const names = [];
  const pattern = route.path.replace(/\{(\w+)\}/g, (_, name) => { names.push(name); return '([^/]+)'; });
  return { ...route, regex: new RegExp(`^${pattern}$`), names };
}

const compiled = ROUTES.map(compile);

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

const fail = (res, status, code, message) => send(res, status, { error: { code, message } });

function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorised(req, apiKey) {
  if (!apiKey) return true;
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  const key = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : undefined;
  return sameSecret(token ?? key, apiKey);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('body must be JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function createApi({ hub, apiKey } = {}) {
  const handlers = {
    getHealth: (_req, res) => send(res, 200, { ok: true }),
    getStatus: (_req, res) => send(res, 200, hub.status()),
    getMode: (_req, res) => send(res, 200, { mode: hub.getMode(), modes: MODES }),
    setMode: async (req, res) => {
      const body = await readJson(req);
      if (!isMode(body.mode)) return fail(res, 422, 'INVALID_INPUT', `mode must be one of ${MODES.join(', ')}`);
      return send(res, 200, { mode: hub.setMode(body.mode), modes: MODES });
    },
    listLights: (_req, res) => send(res, 200, { lights: hub.lights() }),
    getLight: (_req, res, { id }) => {
      const light = hub.light(id);
      return light ? send(res, 200, light) : fail(res, 404, 'NOT_FOUND', `no light ${id}`);
    },
    setLightManual: async (req, res, { id }) => {
      const body = await readJson(req);
      let look;
      if (body.color === 'off') look = { rgb: [0, 0, 0], blink: false };
      else {
        const rgb = parseHexColor(body.color);
        if (!rgb) return fail(res, 422, 'INVALID_INPUT', 'color must be #rrggbb or "off"');
        if (body.blink !== undefined && typeof body.blink !== 'boolean') return fail(res, 422, 'INVALID_INPUT', 'blink must be true or false');
        look = { rgb, blink: body.blink === true };
      }
      const light = hub.setManual(id, look);
      return light ? send(res, 200, light) : fail(res, 404, 'NOT_FOUND', `no light ${id}`);
    },
  };

  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const match = compiled.find((r) => r.method === req.method && r.regex.test(path));
    if (!match) {
      const other = compiled.some((r) => r.regex.test(path));
      return other ? fail(res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed') : fail(res, 404, 'NOT_FOUND', 'no such route');
    }
    if (match.write && !authorised(req, apiKey)) return fail(res, 401, 'UNAUTHORIZED', 'API key required');
    const values = Object.fromEntries(match.names.map((name, i) => [name, decodeURIComponent(path.match(match.regex)[i + 1])]));
    try {
      await handlers[match.operationId](req, res, values);
    } catch (err) {
      if (err.status) return fail(res, err.status, 'INVALID_INPUT', err.message);
      return fail(res, 500, 'INTERNAL', 'internal error');
    }
    return undefined;
  };
}
