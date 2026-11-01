/**
 * A light: takes readings from one source and hands them to its outputs.
 *
 *   source:  { subscribe(emit): () => void }   emit({ state, detail?, look? })
 *   output:  { name, apply(reading, ctx), close?() }
 *
 * The source (pilight's hub) pushes a fresh reading about once a second. The
 * light re-delivers the current reading every ttlMs / 3 so outputs stay alive,
 * and every output shows its UNKNOWN look when readings stop (the deadman).
 * Based on jsilvanus/stream-light src/core/light.js (MIT), push sources only.
 */
import { DEFAULT_TTL_MS, makeReading } from './reading.js';
import { isState, lookFor, normalizeLook } from './states.js';

export const KIND = 'tally';

export const realClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimeout: (t) => clearTimeout(t),
});

export function createLight({
  source,
  outputs = [],
  look = {},
  ttlMs = DEFAULT_TTL_MS,
  clock = realClock,
  onChange = () => {},
  onError = () => {},
} = {}) {
  if (!source || typeof source.subscribe !== 'function') throw new TypeError('source needs subscribe()');

  let reading = null;
  let running = false;
  let keepAliveTimer = null;
  let unsubscribe = null;

  const ctx = {
    kind: KIND,
    now: () => clock.now(),
    lookFor: (state) => lookFor(state, look),
    // The reading's own look (manual colour) when it has one, else the state's look.
    lookOf: (r, state = r.state) => (state === r.state && r.look) || lookFor(state, look),
  };

  function deliverAll() {
    if (!reading) return Promise.resolve();
    const r = reading;
    return Promise.all(outputs.map(async (output) => {
      try {
        await output.apply(r, ctx);
      } catch (err) {
        onError(err, { output: output.name });
      }
    }));
  }

  function commit({ state, detail, look: readingLook }) {
    const changed = !reading || reading.state !== state || JSON.stringify(reading.look) !== JSON.stringify(normalizeLook(readingLook));
    reading = makeReading({ state, detail, look: readingLook, checkedAt: clock.now(), ttlMs });
    if (changed) {
      try { onChange(reading); } catch (err) { onError(err, { output: 'onChange' }); }
    }
    return deliverAll();
  }

  function keepAlive() {
    if (!running) return;
    keepAliveTimer = clock.setTimeout(keepAlive, Math.max(1000, Math.floor(ttlMs / 3)));
    deliverAll();
  }

  return {
    start() {
      if (running) return;
      running = true;
      keepAliveTimer = clock.setTimeout(keepAlive, Math.max(1000, Math.floor(ttlMs / 3)));
      unsubscribe = source.subscribe((input) => {
        if (!running) return;
        if (!input || !isState(input.state)) {
          onError(new Error(`source emitted invalid state ${input?.state}`), { output: 'source' });
          return;
        }
        commit(input);
      });
      // Until the source reports, we do not know.
      commit({ state: 'UNKNOWN', detail: 'waiting for the source' });
    },
    async stop({ closeOutputs = true } = {}) {
      running = false;
      if (keepAliveTimer) clock.clearTimeout(keepAliveTimer);
      keepAliveTimer = null;
      try { unsubscribe?.(); } catch { /* ignore */ }
      unsubscribe = null;
      if (closeOutputs) {
        await Promise.all(outputs.map(async (o) => {
          try { await o.close?.(); } catch (err) { onError(err, { output: o.name }); }
        }));
      }
    },
    snapshot() {
      return { running, reading };
    },
  };
}
