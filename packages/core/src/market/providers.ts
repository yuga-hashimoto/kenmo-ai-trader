import type {
  DailyBar,
  DisclosureData,
  FinancialResultData,
  IntradayBar,
  StrategyConfig,
  SymbolData,
} from '../types/index.js';
import type { Candidate } from '../strategy/candidates.js';
import type { MarketDataProvider } from './MarketDataProvider.js';

/** Optional intraday capability. The engine is daily by default but can use this when present. */
export interface IntradayCapable {
  getIntradayBars(symbol: string, date: string): Promise<IntradayBar[]>;
}

export function hasIntraday(p: MarketDataProvider): p is MarketDataProvider & IntradayCapable {
  return typeof (p as Partial<IntradayCapable>).getIntradayBars === 'function';
}

/** Disclosure (適時開示) source: 決算短信 / 上方修正 / 増配 / 中期経営計画 / 月次 など。 */
export interface DisclosureProvider {
  getDisclosures(symbol: string, until: string): Promise<DisclosureData[]>;
  getLatestDisclosures(until: string, limit: number): Promise<DisclosureData[]>;
}

/**
 * Real external market-data provider skeleton (e.g. J-Quants). Implements the same
 * MarketDataProvider interface and is fully opt-in: it only activates when a token
 * is configured, otherwise the caller should use the seed/CSV provider. This is
 * MARKET DATA only — never a brokerage credential, and never required to run the app.
 *
 * Wire `fetchJson` to the real endpoints to go live; the shape below matches the
 * J-Quants `/prices/daily_quotes`, `/fins/statements`, `/fins/announcement` APIs.
 */
export interface ExternalProviderConfig {
  baseUrl: string;
  idToken: string;
}

export class JQuantsMarketDataProvider implements MarketDataProvider, DisclosureProvider {
  readonly providerName = 'jquants';

  constructor(private readonly config: ExternalProviderConfig) {}

  private async fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.config.idToken}` },
    });
    if (!res.ok) throw new Error(`jquants ${path} -> ${res.status}`);
    return res.json() as Promise<T>;
  }

  async getSymbols(): Promise<SymbolData[]> {
    type Row = { Code: string; CompanyName: string; MarketCodeName: string; Sector17CodeName: string };
    const data = await this.fetchJson<{ info: Row[] }>('/listed/info');
    return data.info.map((r) => ({
      code: r.Code,
      name: r.CompanyName,
      market: r.MarketCodeName,
      sector: r.Sector17CodeName,
      marketCapJpy: null,
      lotSize: 100,
      isActive: true,
    }));
  }

  async getTradingDates(): Promise<string[]> {
    const data = await this.fetchJson<{ trading_calendar: Array<{ Date: string; HolidayDivision: string }> }>(
      '/markets/trading_calendar',
    );
    return data.trading_calendar
      .filter((d) => d.HolidayDivision === '1')
      .map((d) => d.Date)
      .sort();
  }

  async getDailyPrices(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    type Row = { Date: string; Open: number; High: number; Low: number; Close: number; Volume: number; TurnoverValue: number };
    const data = await this.fetchJson<{ daily_quotes: Row[] }>(
      `/prices/daily_quotes?code=${symbol}&from=${from}&to=${to}`,
    );
    return data.daily_quotes.map((r) => ({
      symbolCode: symbol,
      date: r.Date,
      open: r.Open,
      high: r.High,
      low: r.Low,
      close: r.Close,
      volume: r.Volume,
      turnoverValue: r.TurnoverValue,
    }));
  }

  async getDailyPrice(symbol: string, date: string): Promise<DailyBar | null> {
    const bars = await this.getDailyPrices(symbol, date, date);
    return bars[0] ?? null;
  }

  async getLatestPrice(symbol: string, at: string): Promise<DailyBar | null> {
    const from = new Date(new Date(at).getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
    const bars = await this.getDailyPrices(symbol, from, at);
    return bars.length > 0 ? bars[bars.length - 1]! : null;
  }

  async getFinancialResults(symbol: string, until: string): Promise<FinancialResultData[]> {
    // Map J-Quants /fins/statements rows to FinancialResultData (fields abbreviated).
    void symbol;
    void until;
    return [];
  }

  async getDisclosures(symbol: string, until: string): Promise<DisclosureData[]> {
    void symbol;
    void until;
    return [];
  }

  async getLatestDisclosures(until: string, limit: number): Promise<DisclosureData[]> {
    void until;
    void limit;
    return [];
  }

  async getCandidates(_date: string, _config: StrategyConfig): Promise<Candidate[]> {
    void _date;
    void _config;
    // Candidate generation requires bars+financials across the universe; in practice
    // hydrate a SeedMarketDataProvider from cached J-Quants pulls and delegate.
    return [];
  }
}

/**
 * Factory: pick a provider from env. Returns null when no external provider is
 * configured so callers fall back to the seed/DB provider (the default path).
 */
export function createExternalProvider(
  env: NodeJS.ProcessEnv = process.env,
): JQuantsMarketDataProvider | null {
  if (env.MARKET_DATA_PROVIDER === 'jquants' && env.JQUANTS_BASE_URL && env.JQUANTS_ID_TOKEN) {
    return new JQuantsMarketDataProvider({
      baseUrl: env.JQUANTS_BASE_URL,
      idToken: env.JQUANTS_ID_TOKEN,
    });
  }
  return null;
}
