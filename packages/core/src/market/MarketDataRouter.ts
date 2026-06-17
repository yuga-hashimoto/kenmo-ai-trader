/**
 * MarketDataRouter — selects the appropriate data provider based on trading mode.
 * Priority rules (from spec):
 *   Backtest: PostgreSQL cached data > Seed/Csv fallback.
 *   Paper:    BrokerQuoteProvider > PostgreSQL cached latest.
 *   Ingestion: JQuants/TDnet/EDINET/CSV write DB cache first; Strategy Engine
 *   reads through MarketDataProvider and does not call external APIs directly.
 */

import type { MarketDataProvider } from './MarketDataProvider.js';
import type { TDnetProvider } from './TDnetProvider.js';

export type DataRoutingMode = 'backtest' | 'paper' | 'live';

export interface MarketDataRouterConfig {
  mode: DataRoutingMode;
  primaryProvider: MarketDataProvider;
  fallbackProvider?: MarketDataProvider;
  disclosureProvider?: TDnetProvider;
}

export class MarketDataRouter implements MarketDataProvider {
  private readonly primary: MarketDataProvider;
  private readonly fallback: MarketDataProvider | undefined;

  constructor(private readonly config: MarketDataRouterConfig) {
    this.primary = config.primaryProvider;
    this.fallback = config.fallbackProvider;
  }

  private async withFallback<T>(
    primary: () => Promise<T>,
    fallback: (() => Promise<T>) | undefined,
    emptyValue: T,
  ): Promise<T> {
    try {
      return await primary();
    } catch (err) {
      if (fallback) {
        console.warn(`[MarketDataRouter] primary failed, using fallback: ${String(err)}`);
        try {
          return await fallback();
        } catch (fallbackErr) {
          console.warn(`[MarketDataRouter] fallback also failed: ${String(fallbackErr)}`);
        }
      }
      return emptyValue;
    }
  }

  getSymbols = () =>
    this.withFallback(
      () => this.primary.getSymbols(),
      this.fallback ? () => this.fallback!.getSymbols() : undefined,
      [],
    );

  getTradingDates = () =>
    this.withFallback(
      () => this.primary.getTradingDates(),
      this.fallback ? () => this.fallback!.getTradingDates() : undefined,
      [],
    );

  getDailyPrices = (symbol: string, from: string, to: string) =>
    this.withFallback(
      () => this.primary.getDailyPrices(symbol, from, to),
      this.fallback ? () => this.fallback!.getDailyPrices(symbol, from, to) : undefined,
      [],
    );

  getDailyPrice = (symbol: string, date: string) =>
    this.withFallback(
      () => this.primary.getDailyPrice(symbol, date),
      this.fallback ? () => this.fallback!.getDailyPrice(symbol, date) : undefined,
      null,
    );

  getLatestPrice = (symbol: string, at: string) =>
    this.withFallback(
      () => this.primary.getLatestPrice(symbol, at),
      this.fallback ? () => this.fallback!.getLatestPrice(symbol, at) : undefined,
      null,
    );

  getFinancialResults = (symbol: string, until: string) =>
    this.withFallback(
      () => this.primary.getFinancialResults(symbol, until),
      this.fallback ? () => this.fallback!.getFinancialResults(symbol, until) : undefined,
      [],
    );

  getDisclosures = (symbol: string, until: string) =>
    this.withFallback(
      () => this.primary.getDisclosures(symbol, until),
      this.fallback ? () => this.fallback!.getDisclosures(symbol, until) : undefined,
      [],
    );

  getCandidates = (date: string, config: import('../types/index.js').StrategyConfig) =>
    this.withFallback(
      () => this.primary.getCandidates(date, config),
      this.fallback ? () => this.fallback!.getCandidates(date, config) : undefined,
      [],
    );
}
