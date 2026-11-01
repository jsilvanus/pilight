/**
 * The reading: what a light should show, with the time it was made.
 *
 *   { v: 1, state, detail?, look?, checkedAt, ttlMs }
 *
 * `checkedAt` is epoch milliseconds on pilight's clock. A receiver computes its
 * deadline from the moment it received the reading (`receivedAt + ttlMs`), never
 * from `checkedAt`, so clocks need not agree.
 */
import { normalizeLook } from './states.js';

export const READING_VERSION = 1;
export const DEFAULT_TTL_MS = 15_000;

export function makeReading({ state, detail, look, checkedAt, ttlMs = DEFAULT_TTL_MS }) {
  const reading = { v: READING_VERSION, state, checkedAt: checkedAt ?? Date.now(), ttlMs };
  if (detail) reading.detail = String(detail);
  const normalized = normalizeLook(look);
  if (normalized) reading.look = normalized;
  return reading;
}

/**
 * The state to show now: the reading's own state while it is fresh, UNKNOWN once
 * `receivedAt + ttlMs` has passed (the deadman).
 */
export function effectiveState(reading, receivedAt, now) {
  if (!reading) return 'UNKNOWN';
  return now - receivedAt > reading.ttlMs ? 'UNKNOWN' : reading.state;
}
