/**
 * PostgresMarketDataProvider — reads market data directly from the database.
 * Uses lazy queries (per-call) instead of bulk-loading all data into memory.
 * Accepts a Prisma-like client via constructor injection so it can be used
 * from @kenmo/api without creating a circular dependency.
 */

import type {
  DailyBar,
  DisclosureData,
  FinancialResultData,
  MarketDataset,
  StrategyConfig,
  SymbolData,
} from '../types/index.js';
import type { MarketDataProvider } from './MarketDataProvider.js';
import type { Candidate } from '../strategy/candidates.js';
import { SeedMarketDataProvider } from './MarketDataProvider.js';

/** Minimal Prisma-like interface (subset used by this provider). */
export interface PrismaLike {
  symbol: {
    findMany(args?: {
      where?: { isActive?: boolean };
      orderBy?: { code?: 'asc' | 'desc' };
    }): Promise<Array<{
      code: string; name: string; market: string; sector: string;
      marketCapJpy: number | null; lotSize: number; isActive: boolean;
    }>>;
  };
  dailyPrice: {
    findMany(args?: {
      where?: {
        symbolCode?: string;
        date?: { gte?: Date; lte?: Date };
      };
      orderBy?: { date?: 'asc' | 'desc' };
      take?: number;
    }): Promise<Array<{
      symbolCode: string; date: Date;
      open: number; high: number; low: number; close: number;
      volume: number; turnoverValue: number;
    }>>;
    findFirst(args?: {
      where?: { symbolCode?: string; date?: { lte?: Date } };
      orderBy?: { date?: 'desc' };
    }): Promise<{ symbolCode: string; date: Date; open: number; high: number; low: number; close: number; volume: number; turnoverValue: number; } | null>;
  };
  financialResult: {
    findMany(args?: {
      where?: { symbolCode?: string; announcedAt?: { lte?: Date } };
      orderBy?: { announcedAt?: 'asc' | 'desc' };
    }): Promise<Array<{
      symbolCode: string; announcedAt: Date; fiscalPeriod: string;
      sales: number; operatingProfit: number; ordinaryProfit: number; netIncome: number;
      salesYoyPct: number; operatingProfitYoyPct: number; operatingMarginPct: number;
      operatingMarginPrevPct: number; roePct: number; progressRateOpPct: number;
      guidanceRevision: string;
    }>>;
  };
  disclosure: {
    findMany(args?: {
      where?: { symbolCode?: string; disclosedAt?: { lte?: Date } };
      orderBy?: { disclosedAt?: 'asc' | 'desc' };
    }): Promise<Array<{
      symbolCode: string; disclosedAt: Date; disclosureType: string; title: string; summary: string;
    }>>;
  };
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export class PostgresMarketDataProvider implements MarketDataProvider {
  constructor(private readonly db: PrismaLike) {}

  async getSymbols(): Promise<SymbolData[]> {
    const rows = await this.db.symbol.findMany({ orderBy: { code: 'asc' } });
    return rows.map((s) => ({
      code: s.code,
      name: s.name,
      market: s.market,
      sector: s.sector,
      marketCapJpy: s.marketCapJpy,
      lotSize: s.lotSize,
      isActive: s.isActive,
    }));
  }

  async getTradingDates(): Promise<string[]> {
    const rows = await this.db.dailyPrice.findMany({ orderBy: { date: 'asc' } });
    const set = new Set<string>();
    for (const r of rows) set.add(iso(r.date));
    return [...set].sort();
  }

  async getDailyPrices(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    const rows = await this.db.dailyPrice.findMany({
      where: {
        symbolCode: symbol,
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) },
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({
      symbolCode: r.symbolCode,
      date: iso(r.date),
      open: r.open, high: r.high, low: r.low, close: r.close,
      volume: r.volume, turnoverValue: r.turnoverValue,
    }));
  }

  async getDailyPrice(symbol: string, date: string): Promise<DailyBar | null> {
    const rows = await this.getDailyPrices(symbol, date, date);
    return rows[0] ?? null;
  }

  async getLatestPrice(symbol: string, at: string): Promise<DailyBar | null> {
    const row = await this.db.dailyPrice.findFirst({
      where: {
        symbolCode: symbol,
        date: { lte: new Date(`${at}T23:59:59Z`) },
      },
      orderBy: { date: 'desc' },
    });
    if (!row) return null;
    return {
      symbolCode: row.symbolCode,
      date: iso(row.date),
      open: row.open, high: row.high, low: row.low, close: row.close,
      volume: row.volume, turnoverValue: row.turnoverValue,
    };
  }

  async getFinancialResults(symbol: string, until: string): Promise<FinancialResultData[]> {
    const rows = await this.db.financialResult.findMany({
      where: {
        symbolCode: symbol,
        announcedAt: { lte: new Date(`${until}T23:59:59Z`) },
      },
      orderBy: { announcedAt: 'asc' },
    });
    return rows.map((f) => ({
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
      guidanceRevision: f.guidanceRevision as FinancialResultData['guidanceRevision'],
    }));
  }

  async getDisclosures(symbol: string, until: string): Promise<DisclosureData[]> {
    const rows = await this.db.disclosure.findMany({
      where: {
        symbolCode: symbol,
        disclosedAt: { lte: new Date(`${until}T23:59:59Z`) },
      },
      orderBy: { disclosedAt: 'asc' },
    });
    return rows.map((d) => ({
      symbolCode: d.symbolCode,
      disclosedAt: d.disclosedAt.toISOString(),
      disclosureType: d.disclosureType as DisclosureData['disclosureType'],
      title: d.title,
      summary: d.summary,
    }));
  }

  /**
   * getCandidates for Postgres provider: loads data asOf date for each active
   * symbol in memory to run the scoring engine. Uses the same generateCandidates
   * logic as SeedMarketDataProvider by delegating through it.
   */
  async getCandidates(date: string, config: StrategyConfig): Promise<Candidate[]> {
    // Load the universe as of `date` — only data available at that point in time
    const symbols = await this.getSymbols();
    const activeCodes = symbols.filter((s) => s.isActive).map((s) => s.code);

    // Load all prices up to date for active symbols (needed for indicators)
    const cutoff = new Date(`${date}T23:59:59Z`);
    const priceRows = await this.db.dailyPrice.findMany({
      where: { date: { lte: cutoff } },
      orderBy: { date: 'asc' },
    });
    const finRows = await this.db.financialResult.findMany({
      where: { announcedAt: { lte: cutoff } },
      orderBy: { announcedAt: 'asc' },
    });
    const discRows = await this.db.disclosure.findMany({
      where: { disclosedAt: { lte: cutoff } },
      orderBy: { disclosedAt: 'asc' },
    });

    const dataset: MarketDataset = {
      symbols,
      prices: priceRows.map((r) => ({
        symbolCode: r.symbolCode, date: iso(r.date),
        open: r.open, high: r.high, low: r.low, close: r.close,
        volume: r.volume, turnoverValue: r.turnoverValue,
      })),
      financials: finRows
        .filter((f) => activeCodes.includes(f.symbolCode))
        .map((f) => ({
          symbolCode: f.symbolCode,
          announcedAt: iso(f.announcedAt),
          fiscalPeriod: f.fiscalPeriod,
          sales: f.sales, operatingProfit: f.operatingProfit,
          ordinaryProfit: f.ordinaryProfit, netIncome: f.netIncome,
          salesYoyPct: f.salesYoyPct, operatingProfitYoyPct: f.operatingProfitYoyPct,
          operatingMarginPct: f.operatingMarginPct, operatingMarginPrevPct: f.operatingMarginPrevPct,
          roePct: f.roePct, progressRateOpPct: f.progressRateOpPct,
          guidanceRevision: f.guidanceRevision as FinancialResultData['guidanceRevision'],
        })),
      disclosures: discRows
        .filter((d) => activeCodes.includes(d.symbolCode))
        .map((d) => ({
          symbolCode: d.symbolCode,
          disclosedAt: d.disclosedAt.toISOString(),
          disclosureType: d.disclosureType as DisclosureData['disclosureType'],
          title: d.title,
          summary: d.summary,
        })),
    };

    const seed = new SeedMarketDataProvider(dataset);
    return seed.getCandidates(date, config);
  }
}
