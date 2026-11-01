/**
 * Webhook output: POST a JSON body when the state changes (or the manual colour does).
 *   { lightId, name, kind, state, detail, checkedAt, look }
 * Vendored from stream-light (MIT).
 */
export function createWebhookOutput({
  url,
  headers = {},
  lightId,
  name,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  onError = () => {},
} = {}) {
  if (!url) throw new TypeError('url is required');
  let lastKey = null;
  return {
    name: `webhook:${new URL(url).host}`,
    async apply(reading, ctx) {
      const look = ctx.lookOf(reading);
      const key = `${reading.state}|${JSON.stringify(reading.look ?? null)}`;
      if (key === lastKey) return;
      lastKey = key;
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            lightId, name, kind: ctx.kind, state: reading.state, detail: reading.detail ?? null,
            look, checkedAt: reading.checkedAt,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`webhook answered ${res.status}`);
      } catch (err) {
        lastKey = null; // try again on the next reading
        onError(err);
      }
    },
  };
}
