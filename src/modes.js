/**
 * What a light should show, per mode. Pure: takes the feeds and the clock as input.
 *
 *   manual   the colour set by hand (UNKNOWN never; default dark)
 *   atem     camera tally: PGM when the light's ATEM input is on program,
 *            PRV when on preview, OFF otherwise
 *   encoder  LIVE while the Monarch encoder streams, OFF otherwise
 *   youtube  LIVE when the YouTube status is live, OFF when offline
 *
 * A feed that pigateway has not answered for `staleMs` makes the auto modes
 * UNKNOWN: pilight does not guess.
 */

export const MODES = Object.freeze(['manual', 'atem', 'encoder', 'youtube']);
export const FEEDS = Object.freeze(['atem', 'encoder', 'youtube']);
export const ENCODER_CHOICES = Object.freeze(['any', 'encoder1', 'encoder2']);

/** A stream is on when an encoder state says so. Unverified against the real Monarch values. */
const STREAMING = /stream/i;

export function isMode(mode) {
  return MODES.includes(mode);
}

export function isFresh(feed, now, staleMs) {
  return Boolean(feed?.data) && now - feed.lastOkAt <= staleMs;
}

export function readingFor({ mode, light, feeds, manual, now, staleMs }) {
  if (mode === 'manual') {
    return { state: 'MANUAL', detail: manual ? 'set by hand' : 'no colour set', look: manual ?? { rgb: [0, 0, 0], blink: false } };
  }
  const feed = feeds[mode];
  if (!isFresh(feed, now, staleMs)) return { state: 'UNKNOWN', detail: `no answer from pigateway (${mode})` };
  const data = feed.data;

  if (mode === 'atem') {
    if (!data.connected) return { state: 'UNKNOWN', detail: 'switcher not connected' };
    if (light.atemInput == null) return { state: 'UNKNOWN', detail: 'light has no ATEM input' };
    if (data.programInput === light.atemInput) return { state: 'PGM' };
    if (data.previewInput === light.atemInput) return { state: 'PRV' };
    return { state: 'OFF' };
  }

  if (mode === 'encoder') {
    if (!data.connected) return { state: 'UNKNOWN', detail: 'encoder not connected' };
    const picked = (light.encoder ?? 'any') === 'any' ? ['encoder1', 'encoder2'] : [light.encoder];
    const streaming = picked.map((key) => data[key]).find((e) => e && STREAMING.test(String(e.state)));
    if (streaming) return { state: 'LIVE', detail: `${streaming.mode} ${streaming.state}` };
    return { state: 'OFF' };
  }

  if (mode === 'youtube') {
    if (data.state === 'live') return { state: 'LIVE', detail: data.detail };
    if (data.state === 'offline') return { state: 'OFF', detail: data.detail };
    return { state: 'UNKNOWN', detail: data.detail ?? 'youtube status unknown' };
  }

  return { state: 'UNKNOWN', detail: `unknown mode ${mode}` };
}

