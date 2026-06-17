import { prisma } from '@kenmo/db';
import { PostgresMarketDataProvider, type MarketDataProvider } from '@kenmo/core';

/**
 * Returns a PostgresMarketDataProvider backed by the shared Prisma client.
 * This provides live-data access: backtests now use whatever data has been
 * ingested via J-Quants / CSV / seed into the DB.
 */
export function loadMarketDataProvider(): MarketDataProvider {
  return new PostgresMarketDataProvider(prisma);
}
