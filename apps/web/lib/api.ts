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

export const pnlClass = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : n >= 0 ? 'pos' : 'neg';
