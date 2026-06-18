/**
 * Live(-ish) last price for a JP symbol from Yahoo's public chart endpoint
 * (regularMarketPrice). Used to value holdings when the dashboard is viewed, so
 * the figures reflect the current quote rather than the last stored daily close.
 * Free Yahoo data is delayed ~15-20 min; cached briefly to avoid hammering it.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { price: number; at: number }>();

/** Mirror YFinancePythonProvider.normalizeJapaneseTicker. */
function toTicker(code: string): string {
  if (/^[A-Z0-9]{5}$/i.test(code) && code.endsWith('0')) return `${code.slice(0, 4)}.T`;
  if (/^[A-Z0-9]{4}$/i.test(code)) return `${code}.T`;
  return `${code}.T`;
}

export async function getLiveQuote(code: string): Promise<number | null> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.price;

  const base = process.env.YAHOO_FINANCE_BASE_URL || 'https://query1.finance.yahoo.com';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}/v8/finance/chart/${toTicker(code)}?interval=1d&range=1d`, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price === 'number' && price > 0) {
      cache.set(code, { price, at: Date.now() });
      return price;
    }
    return null;
  } catch {
    return null; // network/timeout -> caller falls back to the stored close
  } finally {
    clearTimeout(timer);
  }
}
