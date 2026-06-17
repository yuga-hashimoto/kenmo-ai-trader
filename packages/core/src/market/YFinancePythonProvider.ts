import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
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

const execFileAsync = promisify(execFile);
const dayMs = 86_400_000;

export class YFinancePythonProvider implements MarketDataProvider {
  readonly providerName = 'yfinance_python';
  private readonly pythonBin: string;
  private readonly scriptPath: string;
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly rateLimitMs: number;

  constructor(
    private readonly config: {
      symbols?: SymbolData[];
      financials?: FinancialResultData[];
      disclosures?: DisclosureData[];
    } = {},
  ) {
    this.pythonBin = process.env.YFINANCE_PYTHON_BIN || 'python3';
    // Handle monorepo path if cwd is apps/api
    let root = process.cwd();
    if (root.endsWith('apps/api')) {
      root = path.join(root, '../..');
    }
    this.scriptPath = process.env.YFINANCE_SCRIPT_PATH || path.join(root, 'scripts/fetch_yfinance.py');
    const maxConcurrent = Number(process.env.YAHOO_FINANCE_MAX_CONCURRENT || '10');
    this.limit = pLimit(maxConcurrent);
    this.rateLimitMs = Number(process.env.YAHOO_FINANCE_RATE_LIMIT_MS || '0');
  }

  normalizeJapaneseTicker(symbolCode: string): string {
    if (symbolCode === 'NIKKEI225' || symbolCode === '^N225') return '^N225';
    if (symbolCode === 'TOPIX' || symbolCode === '^TOPX') return '^TOPX';
    if (symbolCode === 'MOTHERS_GROWTH' || symbolCode === 'GROWTH_MOCK') return '2516.T';
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

  private async runPythonScript(args: string[]): Promise<any> {
    return this.limit(async () => {
      if (this.rateLimitMs > 0) {
        await this.sleep(this.rateLimitMs);
      }
      try {
        const { stdout, stderr } = await execFileAsync(this.pythonBin, [this.scriptPath, ...args], {
          maxBuffer: 10 * 1024 * 1024, // 10MB
        });
        if (stderr) {
          console.warn(`[YFinancePythonProvider stderr] ${stderr}`);
        }
        const data = JSON.parse(stdout);
        if (!data.ok) {
          throw new Error(data.error || 'Unknown python script error');
        }
        return data;
      } catch (err) {
        console.error(`[YFinancePythonProvider] Command failed: ${this.pythonBin} ${this.scriptPath} ${args.join(' ')}`);
        throw err;
      }
    });
  }

  // --- Fetcher API ---

  async fetchDailyPrices(symbolCode: string, from: Date, to: Date): Promise<DailyBar[]> {
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const data = await this.runPythonScript([
      'daily',
      '--symbol',
      ticker,
      '--from',
      fromStr,
      '--to',
      toStr,
    ]);

    return (data.rows || []).map((r: any) => ({
      symbolCode,
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      turnoverValue: r.close * r.volume,
    }));
  }

  async fetchDailyPricesBulk(symbolCodes: string[], from: Date, to: Date): Promise<Map<string, DailyBar[]>> {
    const results = new Map<string, DailyBar[]>();
    for (const code of symbolCodes) {
      try {
        const bars = await this.fetchDailyPrices(code, from, to);
        results.set(code, bars);
      } catch (err) {
        console.error(`[YFinancePythonProvider] Failed to fetch bulk daily prices for ${code}: ${String(err)}`);
      }
    }
    return results;
  }

  async fetchIndexDailyPrices(indexCode: string, from: Date, to: Date): Promise<DailyBar[]> {
    return this.fetchDailyPrices(indexCode, from, to);
  }

  async fetchDividends(symbolCode: string, from: Date, to: Date): Promise<any[]> {
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const data = await this.runPythonScript([
      'dividends',
      '--symbol',
      ticker,
      '--from',
      fromStr,
      '--to',
      toStr,
    ]);

    return (data.rows || []).map((r: any) => ({
      symbolCode,
      date: r.date,
      amount: r.dividend,
    }));
  }

  async fetchSplits(symbolCode: string, from: Date, to: Date): Promise<any[]> {
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    // Call daily to extract splits
    const data = await this.runPythonScript([
      'daily',
      '--symbol',
      ticker,
      '--from',
      fromStr,
      '--to',
      toStr,
    ]);

    return (data.rows || [])
      .filter((r: any) => r.split && r.split > 0)
      .map((r: any) => ({
        symbolCode,
        date: r.date,
        ratio: String(r.split),
      }));
  }

  async fetchFinancialStatements(symbolCode: string): Promise<any> {
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    const data = await this.runPythonScript([
      'financials',
      '--symbol',
      ticker,
    ]);
    return data;
  }

  async fetchEarningsCalendar(symbolCode?: string): Promise<any> {
    if (!symbolCode) {
      throw new Error('[YFinancePythonProvider] fetchEarningsCalendar requires a symbolCode');
    }
    const ticker = this.normalizeJapaneseTicker(symbolCode);
    // yfinance quoteSummary doesn't have a direct equivalent in the basic script without quoteSummary mock,
    // so we call financials to fetch and return calendar events if possible. For simplicity, return empty calendar events
    // or fetch from standard financials.
    return { calendarEvents: { earnings: { earningsDate: [] } } };
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
}
