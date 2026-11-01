/**
 * States and looks for pilight. Vendored from jsilvanus/stream-light (MIT) and
 * widened: one vocabulary for every mode, so one light can switch between the
 * camera tally, the encoder, the YouTube status and a manual colour.
 *
 *   PGM / PRV / OFF   camera tally (ATEM program, preview, neither)
 *   LIVE / OFF        stream on / off (encoder or YouTube)
 *   MANUAL            a colour set by hand (carried in the reading's `look`)
 *   UNKNOWN           we do not know: the source is gone or stale
 */

export const STATES = Object.freeze([
  'PGM', 'PRV', 'LIVE', 'DEGRADED', 'STARTING', 'OFF', 'MANUAL', 'UNKNOWN',
]);

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const AMBER = [255, 160, 0];
const DARK = [0, 0, 0];

export const DEFAULT_LOOKS = Object.freeze({
  PGM: Object.freeze({ rgb: RED, blink: false }),
  PRV: Object.freeze({ rgb: GREEN, blink: false }),
  LIVE: Object.freeze({ rgb: RED, blink: false }),
  DEGRADED: Object.freeze({ rgb: AMBER, blink: false }),
  STARTING: Object.freeze({ rgb: BLUE, blink: false }),
  OFF: Object.freeze({ rgb: DARK, blink: false }),
  MANUAL: Object.freeze({ rgb: DARK, blink: false }),
  UNKNOWN: Object.freeze({ rgb: AMBER, blink: true }),
});

export function isState(state) {
  return STATES.includes(state);
}

/** Parse `#rrggbb` into `[r, g, b]`; null when it is not a six digit hex colour. */
export function parseHexColor(text) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(text ?? '').trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function clampByte(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(255, Math.max(0, v)) : 0;
}

/**
 * A look is `{ rgb: [r,g,b], blink }`. Accepts that object, a `#rrggbb` string
 * or `blink:#rrggbb`. Returns null for anything else.
 */
export function normalizeLook(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && Array.isArray(raw.rgb) && raw.rgb.length === 3) {
    return { rgb: raw.rgb.map(clampByte), blink: Boolean(raw.blink) };
  }
  if (typeof raw === 'string') {
    const blink = raw.startsWith('blink:');
    const rgb = parseHexColor(blink ? raw.slice(6) : raw);
    if (rgb) return { rgb, blink };
  }
  return null;
}

/** The look of a state: the light's own override for it, else the default. */
export function lookFor(state, overrides = {}) {
  const base = DEFAULT_LOOKS[state] ?? DEFAULT_LOOKS.UNKNOWN;
  return normalizeLook(overrides?.[state]) ?? base;
}
