import {
  MARKET_INDEX_CODE,
  type DailyBar,
  type DisclosureData,
  type FinancialResultData,
  type MarketDataset,
  type StrategyConfig,
  type SymbolData,
} from '../types/index.js';
import type { Candidate, SymbolInput } from '../strategy/candidates.js';
import { generateCandidates } from '../strategy/candidates.js';

/**
 * Abstraction over all market data so the engine never reaches the future. Every
 * read method is bounded by a date so callers cannot accidentally leak forward.
 */
export interface MarketDataProvider {
  getSymbols(): Promise<SymbolData[]>;
  /** all trading dates available (ascending ISO yyyy-mm-dd) */
  getTradingDates(): Promise<string[]>;
  getDailyPrices(symbol: string, from: string, to: string): Promise<DailyBar[]>;
  getDailyPrice(symbol: string, date: string): Promise<DailyBar | null>;
  /** most recent bar at or before `at` */
  getLatestPrice(symbol: string, at: string): Promise<DailyBar | null>;
  getFinancialResults(symbol: string, until: string): Promise<FinancialResultData[]>;
  getDisclosures(symbol: string, until: string): Promise<DisclosureData[]>;
  getCandidates(date: string, config: StrategyConfig): Promise<Candidate[]>;
}

/**
 * In-memory provider used for seed data and tests. Real providers
 * (CsvMarketDataProvider, ExternalMarketDataProvider) implement the same
 * interface so the engine is agnostic to the data source.
 */
export class SeedMarketDataProvider implements MarketDataProvider {
  private readonly pricesBySymbol = new Map<string, DailyBar[]>();
  private readonly finBySymbol = new Map<string, FinancialResultData[]>();
  private readonly discBySymbol = new Map<string, DisclosureData[]>();

  constructor(private readonly dataset: MarketDataset) {
    for (const bar of dataset.prices) {
      const arr = this.pricesBySymbol.get(bar.symbolCode) ?? [];
      arr.push(bar);
      this.pricesBySymbol.set(bar.symbolCode, arr);
    }
    for (const arr of this.pricesBySymbol.values()) {
      arr.sort((a, b) => a.date.localeCompare(b.date));
    }
    for (const fin of dataset.financials) {
      const arr = this.finBySymbol.get(fin.symbolCode) ?? [];
      arr.push(fin);
      this.finBySymbol.set(fin.symbolCode, arr);
    }
    for (const arr of this.finBySymbol.values()) {
      arr.sort((a, b) => a.announcedAt.localeCompare(b.announcedAt));
    }
    for (const d of dataset.disclosures) {
      const arr = this.discBySymbol.get(d.symbolCode) ?? [];
      arr.push(d);
      this.discBySymbol.set(d.symbolCode, arr);
    }
  }

  async getSymbols(): Promise<SymbolData[]> {
    return this.dataset.symbols;
  }

  async getTradingDates(): Promise<string[]> {
    const set = new Set<string>();
    for (const bar of this.dataset.prices) set.add(bar.date);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  async getDailyPrices(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    const arr = this.pricesBySymbol.get(symbol) ?? [];
    return arr.filter((b) => b.date >= from && b.date <= to);
  }

  async getDailyPrice(symbol: string, date: string): Promise<DailyBar | null> {
    const arr = this.pricesBySymbol.get(symbol) ?? [];
    return arr.find((b) => b.date === date) ?? null;
  }

  async getLatestPrice(symbol: string, at: string): Promise<DailyBar | null> {
    const arr = this.pricesBySymbol.get(symbol) ?? [];
    let latest: DailyBar | null = null;
    for (const b of arr) {
      if (b.date <= at) latest = b;
      else break;
    }
    return latest;
  }

  async getFinancialResults(
    symbol: string,
    until: string,
  ): Promise<FinancialResultData[]> {
    const arr = this.finBySymbol.get(symbol) ?? [];
    return arr.filter((f) => f.announcedAt <= until);
  }

  async getDisclosures(symbol: string, until: string): Promise<DisclosureData[]> {
    const arr = this.discBySymbol.get(symbol) ?? [];
    return arr.filter((d) => d.disclosedAt <= until);
  }

  /** Build SymbolInputs as of `date` (no future bars / financials) and score. */
  async getCandidates(date: string, config: StrategyConfig): Promise<Candidate[]> {
    const indexBars = (this.pricesBySymbol.get(MARKET_INDEX_CODE) ?? []).filter(
      (b) => b.date <= date,
    );
    const inputs: SymbolInput[] = [];
    for (const symbol of this.dataset.symbols) {
      if (symbol.code === MARKET_INDEX_CODE) continue; // index is not a tradeable candidate
      const bars = (this.pricesBySymbol.get(symbol.code) ?? []).filter(
        (b) => b.date <= date,
      );
      if (bars.length === 0) continue;
      const fins = (this.finBySymbol.get(symbol.code) ?? []).filter(
        (f) => f.announcedAt <= date,
      );
      const latestFinancial = fins.length > 0 ? fins[fins.length - 1]! : null;
      const disclosureText = (this.discBySymbol.get(symbol.code) ?? [])
        .filter((d) => d.disclosedAt <= date)
        .map((d) => `${d.title} ${d.summary}`)
        .join(' ');
      inputs.push({ symbol, bars, latestFinancial, disclosureText });
    }
    return generateCandidates(inputs, config, { indexBars });
  }
}
