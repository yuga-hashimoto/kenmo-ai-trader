import type { PrismaClient } from '@kenmo/db';
import {
  generateCandidates,
  MARKET_INDEX_CODE,
  type DailyBar,
  type DisclosureData,
  type FinancialResultData,
  type MarketDataProvider,
  type StrategyConfig,
  type SymbolData,
} from '@kenmo/core';
import type { Candidate, SymbolInput } from '@kenmo/core';

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const day = (s: string): Date => new Date(`${s}T00:00:00Z`);

function toSymbol(row: Awaited<ReturnType<PrismaClient['symbol']['findFirstOrThrow']>>): SymbolData {
  return {
    code: row.code,
    name: row.name,
    market: row.market,
    sector: row.sector,
    marketCapJpy: row.marketCapJpy,
    lotSize: row.lotSize,
    isActive: row.isActive,
  };
}

function toDailyBar(row: {
  symbolCode: string;
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnoverValue: number;
}): DailyBar {
  return {
    symbolCode: row.symbolCode,
    date: iso(row.date),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    turnoverValue: row.turnoverValue,
  };
}

function toFinancial(row: {
  symbolCode: string;
  announcedAt: Date;
  fiscalPeriod: string;
  sales: number;
  operatingProfit: number;
  ordinaryProfit: number;
  netIncome: number;
  salesYoyPct: number;
  operatingProfitYoyPct: number;
  operatingMarginPct: number;
  operatingMarginPrevPct: number;
  roePct: number;
  progressRateOpPct: number;
  operatingCashFlowJpy: number | null;
  guidanceRevision: 'none' | 'up' | 'down';
}): FinancialResultData {
  return {
    symbolCode: row.symbolCode,
    announcedAt: iso(row.announcedAt),
    fiscalPeriod: row.fiscalPeriod,
    sales: row.sales,
    operatingProfit: row.operatingProfit,
    ordinaryProfit: row.ordinaryProfit,
    netIncome: row.netIncome,
    salesYoyPct: row.salesYoyPct,
    operatingProfitYoyPct: row.operatingProfitYoyPct,
    operatingMarginPct: row.operatingMarginPct,
    operatingMarginPrevPct: row.operatingMarginPrevPct,
    roePct: row.roePct,
    progressRateOpPct: row.progressRateOpPct,
    operatingCashFlowJpy: row.operatingCashFlowJpy ?? null,
    guidanceRevision: row.guidanceRevision,
  };
}

function toDisclosure(row: {
  symbolCode: string;
  disclosedAt: Date;
  disclosureType: string;
  title: string;
  summary: string;
}): DisclosureData {
  return {
    symbolCode: row.symbolCode,
    disclosedAt: iso(row.disclosedAt),
    disclosureType: row.disclosureType as DisclosureData['disclosureType'],
    title: row.title,
    summary: row.summary,
  };
}

function toIndexBar(row: {
  indexCode: string;
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}): DailyBar {
  return {
    symbolCode: MARKET_INDEX_CODE,
    date: iso(row.date),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume ?? 0,
    turnoverValue: row.close * (row.volume ?? 0),
  };
}

export class PostgresMarketDataProvider implements MarketDataProvider {
  constructor(private readonly db: PrismaClient) {}

  async getSymbols(): Promise<SymbolData[]> {
    const rows = await this.db.symbol.findMany({ orderBy: { code: 'asc' } });
    return rows.map(toSymbol);
  }

  async getTradingDates(): Promise<string[]> {
    const [priceDates, indexDates] = await Promise.all([
      this.db.dailyPrice.findMany({ select: { date: true }, distinct: ['date'], orderBy: { date: 'asc' } }),
      this.db.indexDailyPrice.findMany({ select: { date: true }, distinct: ['date'], orderBy: { date: 'asc' } }),
    ]);
    return [...new Set([...priceDates, ...indexDates].map((r) => iso(r.date)))].sort();
  }

  async getDailyPrices(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    if (symbol === MARKET_INDEX_CODE) return this.getIndexPrices(from, to);
    const rows = await this.db.dailyPrice.findMany({
      where: { symbolCode: symbol, date: { gte: day(from), lte: day(to) } },
      orderBy: { date: 'asc' },
    });
    return rows.map(toDailyBar);
  }

  async getDailyPrice(symbol: string, date: string): Promise<DailyBar | null> {
    if (symbol === MARKET_INDEX_CODE) {
      const bars = await this.getIndexPrices(date, date);
      return bars[0] ?? null;
    }
    const row = await this.db.dailyPrice.findUnique({
      where: { symbolCode_date: { symbolCode: symbol, date: day(date) } },
    });
    return row ? toDailyBar(row) : null;
  }

  async getLatestPrice(symbol: string, at: string): Promise<DailyBar | null> {
    if (symbol === MARKET_INDEX_CODE) {
      const row = await this.db.indexDailyPrice.findFirst({
        where: { date: { lte: day(at) } },
        orderBy: { date: 'desc' },
      });
      return row ? toIndexBar(row) : null;
    }
    const row = await this.db.dailyPrice.findFirst({
      where: { symbolCode: symbol, date: { lte: day(at) } },
      orderBy: { date: 'desc' },
    });
    return row ? toDailyBar(row) : null;
  }

  async getFinancialResults(symbol: string, until: string): Promise<FinancialResultData[]> {
    const rows = await this.db.financialResult.findMany({
      where: { symbolCode: symbol, announcedAt: { lte: day(until) } },
      orderBy: { announcedAt: 'asc' },
    });
    return rows.map(toFinancial);
  }

  async getDisclosures(symbol: string, until: string): Promise<DisclosureData[]> {
    const rows = await this.db.disclosure.findMany({
      where: { symbolCode: symbol, disclosedAt: { lte: day(until) } },
      orderBy: { disclosedAt: 'asc' },
    });
    return rows.map(toDisclosure);
  }

  async getCandidates(date: string, config: StrategyConfig): Promise<Candidate[]> {
    const symbols = await this.getSymbols();
    const indexBars = await this.getIndexPrices('1900-01-01', date);
    const inputs: SymbolInput[] = [];

    for (const symbol of symbols) {
      const [bars, financials, disclosures] = await Promise.all([
        this.getDailyPrices(symbol.code, '1900-01-01', date),
        this.getFinancialResults(symbol.code, date),
        this.getDisclosures(symbol.code, date),
      ]);
      if (bars.length === 0) continue;
      inputs.push({
        symbol,
        bars,
        latestFinancial: financials.at(-1) ?? null,
        disclosureText: disclosures.map((d) => `${d.title} ${d.summary}`).join(' '),
      });
    }

    return generateCandidates(inputs, config, { indexBars });
  }

  private async getIndexPrices(from: string, to: string): Promise<DailyBar[]> {
    const rows = await this.db.indexDailyPrice.findMany({
      where: { date: { gte: day(from), lte: day(to) } },
      orderBy: [{ indexCode: 'asc' }, { date: 'asc' }],
    });
    return rows.map(toIndexBar).sort((a, b) => a.date.localeCompare(b.date));
  }
}
