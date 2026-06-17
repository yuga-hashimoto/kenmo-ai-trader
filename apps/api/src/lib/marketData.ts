import { prisma } from '@kenmo/db';
import {
  buildSampleDataset,
  SeedMarketDataProvider,
  type MarketDataProvider,
} from '@kenmo/core';
import { PostgresMarketDataProvider } from './PostgresMarketDataProvider.js';

/**
 * Backtest/Paper market-data router:
 *   1. PostgreSQL cache populated by J-Quants/CSV ingestion.
 *   2. Seed fixture fallback only when the DB has no cached daily prices yet.
 *
 * Strategy Engine never calls JQuantsProvider directly; external sources ingest
 * into the DB first, then PostgresMarketDataProvider serves as-of bounded reads.
 */
export async function loadMarketDataProvider(): Promise<MarketDataProvider> {
  const cachedDailyPrices = await prisma.dailyPrice.count();
  if (cachedDailyPrices > 0) return new PostgresMarketDataProvider(prisma);
  return new SeedMarketDataProvider(buildSampleDataset());
}
