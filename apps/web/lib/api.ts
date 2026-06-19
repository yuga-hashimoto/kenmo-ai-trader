// Browser calls go to /api/* which Next.js rewrites to the Fastify API.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send a JSON content-type when there is actually a body, otherwise some
  // servers reject the empty body. (No-body POSTs: /run, /start, /promote, …)
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body != null) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = res.statusText;
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const fmtJpy = (n: number | null | undefined): string =>
  n === null || n === undefined ? '-' : `¥${Math.round(n).toLocaleString()}`;

export const fmtPct = (n: number | null | undefined, digits = 1): string =>
  n === null || n === undefined ? '-' : `${n.toFixed(digits)}%`;

export const fmtDate = (d: string | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 10) : '-';

// J-Quants stores Japanese tickers as a 5-char local code: the familiar 4-char
// ticker with a "0" appended (5998 → 59980, 135A → 135A0). Strip it for display
// so users see the code they know. Other shapes pass through unchanged.
export const fmtSymbol = (code: string | null | undefined): string =>
  code && code.length === 5 && code.endsWith('0') ? code.slice(0, 4) : (code ?? '');

// Public stock-detail page (chart, financials) for a ticker, keyed by the 4-digit code.
export const minkabuUrl = (code: string | null | undefined): string =>
  `https://minkabu.jp/stock/${fmtSymbol(code)}`;

export const pnlClass = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : n >= 0 ? 'pos' : 'neg';
