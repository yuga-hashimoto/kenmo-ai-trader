/**
 * Backfill the market-regime index (MARKET_INDEX_CODE = 'GROWTH_MOCK', Yahoo
 * 2516.T = Growth-250 ETF) into DailyPrice. The strategy's MarketRegimeFilter and
 * RelativeStrength read this code from DailyPrice; without it the regime is dead.
 * The symbol is kept active so the daily ingestion auto-refreshes it, but
 * getCandidates skips MARKET_INDEX_CODE so it is never traded.
 *
 *   node scripts/ingest_index.mjs   (DATABASE_URL must be set)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(SCRIPTS_DIR, '../packages/db/package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const INDEX_CODE = 'GROWTH_MOCK';
const INDEX_TICKER = '2516.T';

function fetchDaily(ticker, from, to) {
  return new Promise((resolve) => {
    const p = spawn('python3', [join(SCRIPTS_DIR, 'fetch_yfinance.py'), 'daily', '--symbol', ticker, '--from', from, '--to', to]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      try {
        resolve(JSON.parse(out).rows ?? []);
      } catch {
        resolve([]);
      }
    });
  });
}

async function main() {
  await prisma.symbol.upsert({
    where: { code: INDEX_CODE },
    create: { code: INDEX_CODE, name: 'グロース250指数 (2516.T)', market: 'INDEX', sector: 'INDEX', lotSize: 1, isActive: true },
    update: { isActive: true, market: 'INDEX' },
  });

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const rows = await fetchDaily(INDEX_TICKER, from, to);
  let n = 0;
  for (const r of rows) {
    if (r.close == null) continue;
    const date = new Date(`${r.date}T00:00:00Z`);
    const data = {
      open: r.open, high: r.high, low: r.low, close: r.close,
      volume: Math.round(r.volume ?? 0), turnoverValue: (r.close ?? 0) * (r.volume ?? 0),
    };
    await prisma.dailyPrice.upsert({
      where: { symbolCode_date: { symbolCode: INDEX_CODE, date } },
      create: { symbolCode: INDEX_CODE, date, ...data },
      update: data,
    });
    n += 1;
  }
  console.log(`[index] ${INDEX_CODE} (${INDEX_TICKER}): ${n} daily bars upserted`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[index] failed:', e);
  process.exit(1);
});
