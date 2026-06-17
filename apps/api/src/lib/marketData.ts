import { prisma } from '@kenmo/db';
import {
  SeedMarketDataProvider,
  type MarketDataProvider,
  type MarketDataset,
} from '@kenmo/core';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Loads the entire market dataset from Postgres into the in-memory
 * SeedMarketDataProvider. This reuses the unit-tested provider logic and keeps
 * the engine identical between tests and production. For very large universes a
 * streaming Prisma-backed provider would replace this — same interface.
 */
export async function loadMarketDataProvider(): Promise<MarketDataProvider> {
  const [symbols, prices, financials, disclosures] = await Promise.all([
    prisma.symbol.findMany(),
    prisma.dailyPrice.findMany({ orderBy: { date: 'asc' } }),
    prisma.financialResult.findMany({ orderBy: { announcedAt: 'asc' } }),
    prisma.disclosure.findMany({ orderBy: { disclosedAt: 'asc' } }),
  ]);

  const dataset: MarketDataset = {
    symbols: symbols.map((s) => ({
      code: s.code,
      name: s.name,
      market: s.market,
      sector: s.sector,
      marketCapJpy: s.marketCapJpy,
      lotSize: s.lotSize,
      isActive: s.isActive,
    })),
    prices: prices.map((p) => ({
      symbolCode: p.symbolCode,
      date: iso(p.date),
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume,
      turnoverValue: p.turnoverValue,
    })),
    financials: financials.map((f) => ({
      symbolCode: f.symbolCode,
      announcedAt: iso(f.announcedAt),
      fiscalPeriod: f.fiscalPeriod,
      sales: f.sales,
      operatingProfit: f.operatingProfit,
      ordinaryProfit: f.ordinaryProfit,
      netIncome: f.netIncome,
      salesYoyPct: f.salesYoyPct,
      operatingProfitYoyPct: f.operatingProfitYoyPct,
      operatingMarginPct: f.operatingMarginPct,
      operatingMarginPrevPct: f.operatingMarginPrevPct,
      roePct: f.roePct,
      progressRateOpPct: f.progressRateOpPct,
      guidanceRevision: f.guidanceRevision,
    })),
    disclosures: disclosures.map((d) => ({
      symbolCode: d.symbolCode,
      disclosedAt: iso(d.disclosedAt),
      disclosureType: d.disclosureType as MarketDataset['disclosures'][number]['disclosureType'],
      title: d.title,
      summary: d.summary,
    })),
  };

  return new SeedMarketDataProvider(dataset);
}
