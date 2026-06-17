import type { DailyBar, MarketDataset, SymbolData } from '../types/index.js';
import { SeedMarketDataProvider, type MarketDataProvider } from './MarketDataProvider.js';

/**
 * Parses daily-price CSV text into a dataset and delegates reads to the in-memory
 * provider. Expected CSV header:
 *   symbolCode,date,open,high,low,close,volume,turnoverValue
 *
 * Financials/disclosures may be supplied separately. This keeps the door open for
 * loading real historical data without changing the engine.
 */
export class CsvMarketDataProvider implements MarketDataProvider {
  private readonly inner: SeedMarketDataProvider;

  constructor(
    pricesCsv: string,
    options: {
      symbols: SymbolData[];
      financials?: MarketDataset['financials'];
      disclosures?: MarketDataset['disclosures'];
    },
  ) {
    const prices = CsvMarketDataProvider.parsePricesCsv(pricesCsv);
    const dataset: MarketDataset = {
      symbols: options.symbols,
      prices,
      financials: options.financials ?? [],
      disclosures: options.disclosures ?? [],
    };
    this.inner = new SeedMarketDataProvider(dataset);
  }

  static parsePricesCsv(csv: string): DailyBar[] {
    const lines = csv.trim().split(/\r?\n/);
    const bars: DailyBar[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim() === '') continue;
      const cols = line.split(',');
      if (cols.length < 8) continue;
      bars.push({
        symbolCode: cols[0]!.trim(),
        date: cols[1]!.trim(),
        open: Number(cols[2]),
        high: Number(cols[3]),
        low: Number(cols[4]),
        close: Number(cols[5]),
        volume: Number(cols[6]),
        turnoverValue: Number(cols[7]),
      });
    }
    return bars;
  }

  getSymbols = (): ReturnType<MarketDataProvider['getSymbols']> => this.inner.getSymbols();
  getTradingDates = (): ReturnType<MarketDataProvider['getTradingDates']> =>
    this.inner.getTradingDates();
  getDailyPrices: MarketDataProvider['getDailyPrices'] = (s, f, t) =>
    this.inner.getDailyPrices(s, f, t);
  getDailyPrice: MarketDataProvider['getDailyPrice'] = (s, d) =>
    this.inner.getDailyPrice(s, d);
  getLatestPrice: MarketDataProvider['getLatestPrice'] = (s, a) =>
    this.inner.getLatestPrice(s, a);
  getFinancialResults: MarketDataProvider['getFinancialResults'] = (s, u) =>
    this.inner.getFinancialResults(s, u);
  getDisclosures: MarketDataProvider['getDisclosures'] = (s, u) =>
    this.inner.getDisclosures(s, u);
  getCandidates: MarketDataProvider['getCandidates'] = (d, c) =>
    this.inner.getCandidates(d, c);
}

/**
 * Placeholder for a future external provider (e.g. J-Quants, kabu station market
 * data). Implement the same interface and the engine works unchanged.
 */
export interface ExternalMarketDataProvider extends MarketDataProvider {
  readonly providerName: string;
}
