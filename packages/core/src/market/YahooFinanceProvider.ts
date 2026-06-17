import YahooFinance from 'yahoo-finance2';
import pLimit from 'p-limit';
import type {
  DailyBar,
  DisclosureData,
  FinancialResultData,
  MarketDataset,
  StrategyConfig,
  SymbolData,
} from '../types/index.js';
import type { Candidate } from '../strategy/candidates.js';
import type { MarketDataProvider } from './MarketDataProvider.js';

const dayMs = 86_400_000;
const toUnixSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

export class YahooFinanceProvider implements MarketDataProvider {
  readonly providerName = 'yahoo_finance';
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly rateLimitMs: number;
  private readonly yahooFinance: any;

  constructor(
    private readonly config: {
      baseUrl?: string;
      symbols?: SymbolData[];
      financials?: FinancialResultData[];
      disclosures?: DisclosureData[];
    } = {},
  ) {
    const maxConcurrent = Number(process.env.YAHOO_FINANCE_MAX_CONCURRENT || '10');
    this.limit = pLimit(maxConcurrent);
    this.rateLimitMs = Number(process.env.YAHOO_FINANCE_RATE_LIMIT_MS || '0');
    
    // Initialize yahoo-finance2 instance
    this.yahooFinance = new YahooFinance();
  }

  // Helper to normalize Japanese tickers
  normalizeJapaneseTicker(symbolCode: string): string {
    if (symbolCode === 'NIKKEI225' || symbolCode === '^N225') return '^N225';
    if (symbolCode === 'TOPIX' || symbolCode === '^TOPX') return '^TOPX';
    if (symbolCode === 'MOTHERS_GROWTH' || symbolCode === 'GROWTH_MOCK') return '2516.T'; // proxy to Mothers ETF
    if (/^[A-Z0-9]{5}$/i.test(symbolCode) && symbolCode.endsWith('0')) {
      return `${symbolCode.slice(0, 4)}.T`;
    }
    if (/^[A-Z0-9]{4}$/i.test(symbolCode)) {
      return `${symbolCode}.T`;
    }
    return symbolCode;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async executeWithRetryAndRateLimit<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
    return this.limit(async () => {
      let attempt = 0;
      while (attempt <= retries) {
        try {
          if (this.rateLimitMs > 0) {
            await this.sleep(this.rateLimitMs);
          }
          return await fn();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const isValidationError = errMsg.includes('Historical returned a result with SOME') ||
                                    errMsg.includes('validation') ||
                                    errMsg.includes('Validation') ||
                                    errMsg.includes('No such event') ||
                                    errMsg.includes('No fundamentals data');
          if (isValidationError) {
            // JS library validation error: do not retry, fail immediately to fallback to Python provider
            throw err;
          }

          attempt++;
          if (attempt > retries) {
            throw err;
          }
          const wait = delayMs * Math.pow(2, attempt - 1);
          console.warn(`[YahooFinanceProvider] Attempt ${attempt} failed: ${String(err)}. Retrying in ${wait}ms...`);
          await this.sleep(wait);
        }
      }
      throw new Error('Unreachable retry logic');
    });
  }

  // --- Fetcher API used by Data Ingestion ---

  async fetchDailyPrices(symbolCode: string, from: Date, to: Date): Promise<DailyBar[]> {
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    const period1 = toUnixSeconds(from);
    const period2 = toUnixSeconds(new Date(to.getTime() + dayMs - 1));

    const fn = async () => {
      const results = await this.yahooFinance.historical(
        ticker,
        {
          period1,
          period2,
          interval: '1d',
        },
        { validateResult: false }
      ) as any[];
      
      return results
        .filter((r) => r && r.date && r.open !== null && r.high !== null && r.low !== null && r.close !== null)
        .map((r) => ({
          symbolCode,
          date: r.date.toISOString().slice(0, 10),
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          volume: r.volume ?? 0,
          turnoverValue: (r.close ?? 0) * (r.volume ?? 0),
        }));
    };

    return this.executeWithRetryAndRateLimit(fn);
  }

  async fetchDailyPricesBulk(symbolCodes: string[], from: Date, to: Date): Promise<Map<string, DailyBar[]>> {
    const results = new Map<string, DailyBar[]>();
    for (const code of symbolCodes) {
      try {
        const bars = await this.fetchDailyPrices(code, from, to);
        results.set(code, bars);
      } catch (err) {
        console.error(`[YahooFinanceProvider] Failed to fetch bulk daily prices for ${code}: ${String(err)}`);
      }
    }
    return results;
  }

  async fetchIndexDailyPrices(indexCode: string, from: Date, to: Date): Promise<DailyBar[]> {
    return this.fetchDailyPrices(indexCode, from, to);
  }

  async fetchDividends(symbolCode: string, from: Date, to: Date): Promise<any[]> {
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    const period1 = toUnixSeconds(from);
    const period2 = toUnixSeconds(new Date(to.getTime() + dayMs - 1));

    const fn = async () => {
      return this.yahooFinance.historical(
        ticker,
        {
          period1,
          period2,
          events: 'div',
        },
        { validateResult: false }
      ) as any[];
    };

    const raw = await this.executeWithRetryAndRateLimit(fn);
    return raw
      .filter((r: any) => r && r.date && r.dividends !== null && r.dividends !== undefined)
      .map((r: any) => ({
        symbolCode,
        date: r.date.toISOString().slice(0, 10),
        amount: r.dividends,
      }));
  }

  async fetchSplits(symbolCode: string, from: Date, to: Date): Promise<any[]> {
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    const period1 = toUnixSeconds(from);
    const period2 = toUnixSeconds(new Date(to.getTime() + dayMs - 1));

    const fn = async () => {
      return this.yahooFinance.historical(
        ticker,
        {
          period1,
          period2,
          events: 'split',
        },
        { validateResult: false }
      ) as any[];
    };

    const raw = await this.executeWithRetryAndRateLimit(fn);
    return raw
      .filter((r: any) => r && r.date && r.stockSplits !== null && r.stockSplits !== undefined)
      .map((r: any) => ({
        symbolCode,
        date: r.date.toISOString().slice(0, 10),
        ratio: r.stockSplits, // "2:1" or similar
      }));
  }

  async fetchFinancialStatements(symbolCode: string): Promise<any> {
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    const fn = async () => {
      return this.yahooFinance.quoteSummary(ticker, {
        modules: ['incomeStatementHistory', 'balanceSheetHistory', 'cashflowStatementHistory', 'financialData'],
      });
    };
    return this.executeWithRetryAndRateLimit(fn);
  }

  async fetchEarningsCalendar(symbolCode?: string): Promise<any> {
    if (!symbolCode) {
      throw new Error('[YahooFinanceProvider] fetchEarningsCalendar requires a symbolCode');
    }
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    const fn = async () => {
      return this.yahooFinance.quoteSummary(ticker, {
        modules: ['calendarEvents'],
      });
    };
    return this.executeWithRetryAndRateLimit(fn);
  }

  // --- MarketDataProvider implementation for backwards compatibility ---

  async getSymbols(): Promise<SymbolData[]> {
    return this.config.symbols ?? [];
  }

  async getTradingDates(): Promise<string[]> {
    const symbols = await this.getSymbols();
    if (symbols.length === 0) return [];
    const latest = await this.getDailyPrices(symbols[0]!.code, '1900-01-01', new Date().toISOString().slice(0, 10));
    return latest.map((bar) => bar.date);
  }

  async getDailyPrices(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    return this.fetchDailyPrices(symbol, new Date(from), new Date(to));
  }

  async getDailyPrice(symbol: string, date: string): Promise<DailyBar | null> {
    const bars = await this.getDailyPrices(symbol, date, date);
    return bars[0] ?? null;
  }

  async getLatestPrice(symbol: string, at: string): Promise<DailyBar | null> {
    const fromDate = new Date(new Date(`${at}T00:00:00Z`).getTime() - 14 * dayMs);
    const bars = await this.fetchDailyPrices(symbol, fromDate, new Date(at));
    return bars.at(-1) ?? null;
  }

  async getFinancialResults(symbol: string, until: string): Promise<FinancialResultData[]> {
    return (this.config.financials ?? [])
      .filter((row) => row.symbolCode === symbol && row.announcedAt <= until)
      .sort((a, b) => a.announcedAt.localeCompare(b.announcedAt));
  }

  async getDisclosures(symbol: string, until: string): Promise<DisclosureData[]> {
    return (this.config.disclosures ?? [])
      .filter((row) => row.symbolCode === symbol && row.disclosedAt <= until)
      .sort((a, b) => a.disclosedAt.localeCompare(b.disclosedAt));
  }

  async getCandidates(_date: string, _config: StrategyConfig): Promise<Candidate[]> {
    return [];
  }

  static hydrateDataset(dataset: MarketDataset): YahooFinanceProvider {
    return new YahooFinanceProvider({
      symbols: dataset.symbols,
      financials: dataset.financials,
      disclosures: dataset.disclosures,
    });
  }
}
