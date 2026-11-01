// pilight CLI, built at run time from openapi/openapi.json: one command per operationId.
// No dependencies. Usage: pilight <command> [--param value ...] [--json '{...}']
//   PILIGHT_URL (default http://127.0.0.1:3300), PILIGHT_API_KEY for writes.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function kebab(operationId) {
  return operationId.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function operations(spec) {
  const list = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!op.operationId) continue;
      list.push({ command: kebab(op.operationId), method: method.toUpperCase(), path, op });
    }
  }
  return list.sort((a, b) => a.command.localeCompare(b.command));
}

/** Parse argv after the command: `--name value`, `--flag`, `--json '{...}'`. */
export function parseArgs(argv) {
  const out = { params: {}, json: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (name === 'json') { out.json = JSON.parse(next ?? 'null'); i++; continue; }
    if (next === undefined || next.startsWith('--')) { out.params[name] = true; continue; }
    out.params[name] = next;
    i++;
  }
  return out;
}

export function buildRequest(op, baseUrl, { params, json }, env = {}) {
  let path = op.path;
  for (const name of [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) {
    if (params[name] === undefined) throw new Error(`missing --${name}`);
    path = path.replace(`{${name}}`, encodeURIComponent(String(params[name])));
  }
  const headers = {};
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (env.PILIGHT_API_KEY) headers.Authorization = `Bearer ${env.PILIGHT_API_KEY}`;
  const body = json !== undefined ? JSON.stringify(json) : undefined;
  return { url: new URL(path, baseUrl), init: { method: op.method, headers, body } };
}

export async function run(argv, { env = process.env, fetch: fetchImpl = globalThis.fetch, out = console.log, spec } = {}) {
  const specData = spec ?? JSON.parse(await readFile(fileURLToPath(new URL('../openapi/openapi.json', import.meta.url)), 'utf8'));
  const ops = operations(specData);
  const [command, ...rest] = argv;
  if (!command || command === 'help') {
    out('pilight commands:');
    for (const op of ops) out(`  ${op.command.padEnd(22)} ${op.method.padEnd(4)} ${op.path}  ${op.op.summary ?? ''}`);
    return 0;
  }
  const op = ops.find((o) => o.command === command);
  if (!op) { out(`unknown command ${command}; run pilight help`); return 2; }
  const args = parseArgs(rest);
  const req = buildRequest(op, env.PILIGHT_URL ?? 'http://127.0.0.1:3300', args, env);
  const res = await fetchImpl(req.url, req.init);
  const text = await res.text();
  out(text);
  return res.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error(`pilight: ${err.message}`);
    process.exitCode = 2;
  });
}
