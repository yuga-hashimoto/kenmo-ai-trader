import { prisma } from '@kenmo/db';
import type {
  DailyBar,
  DisclosureData,
  FinancialResultData,
  StrategyConfig,
  SymbolData,
} from '../types/index.js';
import { MARKET_INDEX_CODE } from '../types/index.js';
import type { Candidate, SymbolInput } from '../strategy/candidates.js';
import { generateCandidates } from '../strategy/candidates.js';
import type { MarketDataProvider } from './MarketDataProvider.js';

export class PostgresMarketDataProvider implements MarketDataProvider {
  readonly providerName = 'postgres';

  async getSymbols(): Promise<SymbolData[]> {
    const dbSymbols = await prisma.symbol.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return dbSymbols.map((s) => ({
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
    const dates = await prisma.dailyPrice.findMany({
      select: { date: true },
      distinct: ['date'],
      orderBy: { date: 'asc' },
    });
    return dates.map((d) => d.date.toISOString().slice(0, 10));
  }

  async getDailyPrices(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    const prices = await prisma.dailyPrice.findMany({
      where: {
        symbolCode: symbol,
        date: {
          gte: new Date(`${from}T00:00:00.000Z`),
          lte: new Date(`${to}T23:59:59.999Z`),
        },
      },
      orderBy: { date: 'asc' },
    });
    return prices.map((p) => ({
      symbolCode: p.symbolCode,
      date: p.date.toISOString().slice(0, 10),
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume,
      turnoverValue: p.turnoverValue,
    }));
  }

  async getDailyPrice(symbol: string, date: string): Promise<DailyBar | null> {
    const bars = await this.getDailyPrices(symbol, date, date);
    return bars[0] ?? null;
  }

  async getLatestPrice(symbol: string, at: string): Promise<DailyBar | null> {
    const p = await prisma.dailyPrice.findFirst({
      where: {
        symbolCode: symbol,
        date: {
          lte: new Date(`${at}T23:59:59.999Z`),
        },
      },
      orderBy: { date: 'desc' },
    });
    if (!p) return null;
    return {
      symbolCode: p.symbolCode,
      date: p.date.toISOString().slice(0, 10),
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume,
      turnoverValue: p.turnoverValue,
    };
  }

  async getFinancialResults(symbol: string, until: string): Promise<FinancialResultData[]> {
    const results = await prisma.financialResult.findMany({
      where: {
        symbolCode: symbol,
        announcedAt: {
          lte: new Date(`${until}T23:59:59.999Z`),
        },
      },
      orderBy: { announcedAt: 'asc' },
    });
    return results.map((r) => ({
      symbolCode: r.symbolCode,
      announcedAt: r.announcedAt.toISOString().slice(0, 10),
      fiscalPeriod: r.fiscalPeriod,
      sales: r.sales,
      operatingProfit: r.operatingProfit,
      ordinaryProfit: r.ordinaryProfit,
      netIncome: r.netIncome,
      salesYoyPct: r.salesYoyPct,
      operatingProfitYoyPct: r.operatingProfitYoyPct,
      operatingMarginPct: r.operatingMarginPct,
      operatingMarginPrevPct: r.operatingMarginPrevPct,
      roePct: r.roePct,
      progressRateOpPct: r.progressRateOpPct,
      guidanceRevision: r.guidanceRevision as any,
      rawJson: r.rawJson as any,
    }));
  }

  async getDisclosures(symbol: string, until: string): Promise<DisclosureData[]> {
    const disclosures = await prisma.disclosure.findMany({
      where: {
        symbolCode: symbol,
        disclosedAt: {
          lte: new Date(`${until}T23:59:59.999Z`),
        },
      },
      orderBy: { disclosedAt: 'asc' },
    });
    return disclosures.map((d) => ({
      symbolCode: d.symbolCode,
      disclosedAt: d.disclosedAt.toISOString().slice(0, 10),
      disclosureType: d.disclosureType as any,
      title: d.title,
      summary: d.summary,
      rawText: d.rawText ?? '',
      rawJson: d.rawJson as any,
    }));
  }

  async getCandidates(date: string, config: StrategyConfig): Promise<Candidate[]> {
    const symbols = await this.getSymbols();
    const indexBars = await this.getDailyPrices(MARKET_INDEX_CODE, '1900-01-01', date);

    const inputs: SymbolInput[] = [];
    for (const symbol of symbols) {
      if (symbol.code === MARKET_INDEX_CODE) continue;
      const bars = await this.getDailyPrices(symbol.code, '1900-01-01', date);
      if (bars.length === 0) continue;

      const fins = await this.getFinancialResults(symbol.code, date);
      const latestFinancial = fins.length > 0 ? fins[fins.length - 1]! : null;

      const disclosures = await this.getDisclosures(symbol.code, date);
      const disclosureText = disclosures
        .map((d) => `${d.title} ${d.summary}`)
        .join(' ');

      inputs.push({ symbol, bars, latestFinancial, disclosureText });
    }

    return generateCandidates(inputs, config, { indexBars });
  }
}
