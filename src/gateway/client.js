/**
 * Polls pigateway for the three feeds pilight needs: the ATEM state, the encoder
 * state and the YouTube status. Read-only. The API key is sent as a bearer token
 * and never logged.
 */
export const GATEWAY_FEEDS = Object.freeze(['atem', 'encoder', 'youtube']);

export function createGatewayClient({
  baseUrl,
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 3000,
  pollMs = 3000,
  onFeed = () => {},
  onError = () => {},
} = {}) {
  if (!baseUrl) throw new TypeError('baseUrl is required');
  const base = new URL(baseUrl);
  let timer = null;

  async function pollFeed(name) {
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const res = await fetchImpl(new URL(`/api/v1/${name}`, base), { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`pigateway ${name} answered ${res.status}`);
    onFeed(name, await res.json());
  }

  async function pollNow() {
    await Promise.all(GATEWAY_FEEDS.map((name) => pollFeed(name).catch((err) => onError(err, name))));
  }

  return {
    pollNow,
    start() {
      if (timer) return;
      pollNow();
      timer = setInterval(pollNow, pollMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    baseUrl: base.origin,
  };
}
