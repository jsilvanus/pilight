/**
 * The hub: holds the mode, the feeds from pigateway and the hand-set colours, and
 * drives one core light (with its outputs) per configured light.
 */
import { createLight, realClock } from './core/light.js';
import { lookFor, normalizeLook } from './core/states.js';
import { createTallyMaOutput } from './outputs/tally-ma.js';
import { createWebhookOutput } from './outputs/webhook.js';
import { createConsoleOutput } from './outputs/console.js';
import { isFresh, isMode, readingFor } from './modes.js';

export function buildOutput(spec, light, { onError = () => {} } = {}) {
  switch (spec.type) {
    case 'tally-ma':
      return createTallyMaOutput({ host: spec.host, port: spec.port, tickMs: spec.tickMs, onClose: spec.onClose, onError });
    case 'webhook':
      return createWebhookOutput({ url: spec.url, headers: spec.headers, lightId: light.id, name: light.name, onError });
    case 'console':
      return createConsoleOutput({ label: light.name });
    default:
      throw new TypeError(`unknown output type ${spec.type}`);
  }
}

export function createHub({
  lights: lightConfigs = [],
  mode = 'manual',
  staleMs = 15_000,
  tickMs = 1000,
  clock = realClock,
  makeOutput = buildOutput,
  onError = () => {},
} = {}) {
  if (!isMode(mode)) throw new TypeError(`unknown mode ${mode}`);
  let currentMode = mode;
  const feeds = {};
  const entries = new Map();
  let timer = null;

  for (const config of lightConfigs) {
    if (entries.has(config.id)) throw new TypeError(`duplicate light id ${config.id}`);
    entries.set(config.id, { config, manual: null, emit: null, instance: null });
  }

  const now = () => clock.now();

  function readingOf(entry) {
    return readingFor({ mode: currentMode, light: entry.config, feeds, manual: entry.manual, now: now(), staleMs });
  }

  function emitTo(entry) {
    if (entry.emit) entry.emit(readingOf(entry));
  }

  function refresh() {
    for (const entry of entries.values()) emitTo(entry);
  }

  function describe(entry) {
    const r = readingOf(entry);
    const look = r.look ?? lookFor(r.state, entry.config.look);
    return {
      id: entry.config.id,
      name: entry.config.name,
      mode: currentMode,
      state: r.state,
      detail: r.detail ?? null,
      rgb: look.rgb,
      blink: look.blink,
      manual: entry.manual ? { color: `#${entry.manual.rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`, blink: entry.manual.blink } : null,
    };
  }

  return {
    start() {
      for (const entry of entries.values()) {
        const source = {
          subscribe(emit) {
            entry.emit = emit;
            emitTo(entry);
            return () => { entry.emit = null; };
          },
        };
        const outputs = entry.config.outputs.map((spec) => makeOutput(spec, entry.config, { onError }));
        entry.instance = createLight({ source, outputs, look: entry.config.look ?? {}, clock, onError: (err, info) => onError(err, info) });
        entry.instance.start();
      }
      timer = setInterval(refresh, tickMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await Promise.all([...entries.values()].map((entry) => entry.instance?.stop()));
    },
    onFeed(name, data) {
      feeds[name] = { data, lastOkAt: now() };
      refresh();
    },
    setMode(next) {
      if (!isMode(next)) throw new TypeError(`unknown mode ${next}`);
      currentMode = next;
      refresh();
      return currentMode;
    },
    getMode() {
      return currentMode;
    },
    setManual(id, look) {
      const entry = entries.get(id);
      if (!entry) return null;
      entry.manual = look == null ? null : normalizeLook(look);
      refresh();
      return describe(entry);
    },
    light(id) {
      const entry = entries.get(id);
      return entry ? describe(entry) : null;
    },
    lights() {
      return [...entries.values()].map(describe);
    },
    status() {
      const at = now();
      const feedStatus = Object.fromEntries(['atem', 'encoder', 'youtube'].map((name) => [name, {
        fresh: isFresh(feeds[name], at, staleMs),
        lastOkAt: feeds[name]?.lastOkAt ?? null,
      }]));
      return { mode: currentMode, feeds: feedStatus, lights: [...entries.values()].map(describe) };
    },
  };
}
