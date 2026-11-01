/** Console output: one line per change. Vendored from stream-light (MIT). */
export function createConsoleOutput({ label = 'light', log = (line) => console.log(line) } = {}) {
  let lastKey = null;
  return {
    name: 'console',
    apply(reading, ctx) {
      const key = `${reading.state}|${JSON.stringify(reading.look ?? null)}`;
      if (key === lastKey) return;
      lastKey = key;
      const rgb = ctx.lookOf(reading).rgb.join(',');
      log(`[${label}] ${reading.state} rgb(${rgb})${reading.detail ? ` (${reading.detail})` : ''}`);
    },
  };
}
