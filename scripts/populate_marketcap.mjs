/**
 * Populate Symbol.marketCapJpy for active symbols so the strategy's mid/small-cap
 * universe filter (¥5B–¥150B) activates. marketCap = sharesOutstanding (yfinance)
 * × latest close (already in DB). Run periodically — shares change slowly.
 *
 *   pnpm --filter @kenmo/db exec node ../../scripts/populate_marketcap.mjs
 * or via tsx from the repo root with DATABASE_URL set.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const PY = join(SCRIPTS_DIR, 'fetch_marketcap.py');
const CHUNK = 40;
// Resolve the generated Prisma client from packages/db (not hoisted to root).
const require = createRequire(join(SCRIPTS_DIR, '../packages/db/package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/** Mirror YFinancePythonProvider.normalizeJapaneseTicker. */
function toTicker(code) {
  if (/^[A-Z0-9]{5}$/i.test(code) && code.endsWith('0')) return `${code.slice(0, 4)}.T`;
  if (/^[A-Z0-9]{4}$/i.test(code)) return `${code}.T`;
  return `${code}.T`;
}

function fetchShares(tickers) {
  return new Promise((resolve) => {
    const p = spawn('python3', [PY]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({});
      }
    });
    p.stdin.write(tickers.join('\n'));
    p.stdin.end();
  });
}

async function main() {
  const syms = await prisma.symbol.findMany({ where: { isActive: true }, select: { code: true } });
  let processed = 0;
  let updated = 0;
  for (let i = 0; i < syms.length; i += CHUNK) {
    const batch = syms.slice(i, i + CHUNK);
    const tickerByCode = new Map(batch.map((s) => [s.code, toTicker(s.code)]));
    const shares = await fetchShares([...new Set(tickerByCode.values())]);
    for (const s of batch) {
      processed += 1;
      const sh = shares[tickerByCode.get(s.code)];
      if (!sh) continue;
      const latest = await prisma.dailyPrice.findFirst({
        where: { symbolCode: s.code },
        orderBy: { date: 'desc' },
        select: { close: true },
      });
      if (!latest) continue; // no price yet -> skip, a later run will fill it
      await prisma.symbol.update({
        where: { code: s.code },
        data: { marketCapJpy: sh * latest.close },
      });
      updated += 1;
    }
    console.log(`[marketcap] ${processed}/${syms.length} processed, ${updated} updated`);
  }
  console.log(`[marketcap] DONE: ${updated}/${syms.length} symbols now have a market cap`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[marketcap] failed:', e);
  process.exit(1);
});
