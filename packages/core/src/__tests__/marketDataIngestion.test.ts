import { describe, expect, it, vi, afterEach } from 'vitest';
import XLSX from 'xlsx';
import YahooFinance from 'yahoo-finance2';
import {
  CsvDataImporter,
  JQuantsProvider,
  YahooFinanceProvider,
  JPXListedIssueProvider,
  DataQualityService,
  assertKnownDailyPriceSymbols,
  normalizeFinancialStatements,
  type JQuantsStatement,
} from '../index.js';

describe('JQuantsProvider authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses a configured JQUANTS_ID_TOKEN without requiring refresh credentials first', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('https://example.test/listed/info');
      expect(init?.headers).toEqual({ Authorization: 'Bearer configured-id-token' });
      return new Response(JSON.stringify({ info: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new JQuantsProvider({
      baseUrl: 'https://example.test',
      idToken: 'configured-id-token',
      plan: 'free',
      enableAddons: false,
    });

    await expect(provider.fetchListedIssueMaster()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses a configured V2 API key and maps daily quote fields to the internal shape', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('https://example.test/v2/equities/bars/daily?date=20260325');
      expect(init?.headers).toEqual({ 'x-api-key': 'configured-api-key' });
      return new Response(
        JSON.stringify({
          data: [
            {
              Date: '2026-03-25',
              Code: '13010',
              O: 5110,
              H: 5160,
              L: 5090,
              C: 5140,
              UL: '0',
              LL: '0',
              Vo: 59200,
              Va: 303503000,
              AdjFactor: 1,
              AdjO: 5110,
              AdjH: 5160,
              AdjL: 5090,
              AdjC: 5140,
              AdjVo: 59200,
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new JQuantsProvider({
      baseUrl: 'https://example.test/v2',
      apiKey: 'configured-api-key',
      plan: 'free',
      enableAddons: false,
    });

    await expect(provider.fetchDailyPrices(new Date('2026-03-25T00:00:00Z'))).resolves.toEqual([
      expect.objectContaining({
        Code: '13010',
        Date: '2026-03-25',
        Open: 5110,
        Close: 5140,
        AdjustmentClose: 5140,
        TurnoverValue: 303503000,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('CsvDataImporter', () => {
  it('parses quoted CSV fields containing commas and newlines', () => {
    const rows = CsvDataImporter.importDisclosuresCsv(
      [
        'symbolCode,disclosedAt,disclosureType,title,summary',
        '7203,2024-01-04,earnings,"決算短信, 第3四半期","売上は堅調',
        '利益率も改善"',
      ].join('\n'),
    );

    expect(rows).toEqual([
      {
        symbolCode: '7203',
        disclosedAt: '2024-01-04',
        disclosureType: 'earnings',
        title: '決算短信, 第3四半期',
        summary: '売上は堅調\n利益率も改善',
      },
    ]);
  });

  it('rejects daily prices when listed symbols have not been imported first', () => {
    expect(() =>
      assertKnownDailyPriceSymbols(
        [
          {
            symbolCode: '7203',
            date: '2024-01-04',
            open: 1,
            high: 1,
            low: 1,
            close: 1,
            volume: 1,
            turnoverValue: 1,
          },
        ],
        [],
      ),
    ).toThrow(/listed_issue_master first/);
  });
});

describe('YahooFinanceProvider', () => {
  it('fetches Japanese stock daily bars using the Yahoo .T ticker suffix', async () => {
    const historicalSpy = vi.spyOn(YahooFinance.prototype, 'historical').mockImplementation((async (symbol: string, options: any) => {
      expect(symbol).toBe('7203.T');
      expect(options.period1).toBeDefined();
      return [
        {
          date: new Date('2026-03-25T00:00:00.000Z'),
          open: 3100,
          high: 3150,
          low: 3090,
          close: 3140,
          volume: 12345600,
        },
      ];
    }) as any);

    const provider = new YahooFinanceProvider();
    const rows = await provider.getDailyPrices('7203', '2026-03-25', '2026-03-25');

    expect(rows).toEqual([
      {
        symbolCode: '7203',
        date: '2026-03-25',
        open: 3100,
        high: 3150,
        low: 3090,
        close: 3140,
        volume: 12345600,
        turnoverValue: 38765184000,
      },
    ]);
    expect(historicalSpy).toHaveBeenCalledTimes(1);
    historicalSpy.mockRestore();
  });
});

describe('normalizeFinancialStatements', () => {
  it('calculates YoY and margin improvement from two years of statements', () => {
    const base = {
      DisclosedTime: '15:30',
      LocalCode: '7203',
      DisclosureNumber: '1',
      TypeOfDocument: 'Financial Statements',
      TypeOfCurrentPeriod: '1Q',
      CurrentPeriodStartDate: '',
      CurrentPeriodEndDate: '',
      CurrentFiscalYearStartDate: '',
      CurrentFiscalYearEndDate: '',
      NextFiscalYearStartDate: '',
      NextFiscalYearEndDate: '',
      OrdinaryProfit: '0',
      EarningsPerShare: '',
      DilutedEarningsPerShare: '',
      TotalAssets: '',
      EquityToAssetRatio: '',
      BookValuePerShare: '',
      CashFlowsFromOperatingActivities: '',
      CashFlowsFromInvestingActivities: '',
      CashFlowsFromFinancingActivities: '',
      CashAndEquivalents: '',
      ResultDividendPerShare1stQuarter: '',
      ResultDividendPerShare2ndQuarter: '',
      ResultDividendPerShare3rdQuarter: '',
      ResultDividendPerShareFiscalYearEnd: '',
      ResultDividendPerShareAnnual: '',
      DistributionsPerUnit: '',
      ResultTotalDividendPaidAnnual: '',
      ResultPayoutRatioAnnual: '',
      ForecastDividendPerShare1stQuarter: '',
      ForecastDividendPerShare2ndQuarter: '',
      ForecastDividendPerShare3rdQuarter: '',
      ForecastDividendPerShareFiscalYearEnd: '',
      ForecastDividendPerShareAnnual: '',
      ForecastDistributionsPerUnit: '',
      ForecastTotalDividendPaidAnnual: '',
      ForecastPayoutRatioAnnual: '',
      NextYearForecastDividendPerShare1stQuarter: '',
      NextYearForecastDividendPerShare2ndQuarter: '',
      NextYearForecastDividendPerShare3rdQuarter: '',
      NextYearForecastDividendPerShareFiscalYearEnd: '',
      NextYearForecastDividendPerShareAnnual: '',
      NextYearForecastDistributionsPerUnit: '',
      NextYearForecastPayoutRatioAnnual: '',
      ForecastNetSales2ndQuarter: '',
      ForecastOperatingProfit2ndQuarter: '',
      ForecastOrdinaryProfit2ndQuarter: '',
      ForecastProfit2ndQuarter: '',
      ForecastEarningsPerShare2ndQuarter: '',
      NextYearForecastNetSales2ndQuarter: '',
      NextYearForecastOperatingProfit2ndQuarter: '',
      NextYearForecastOrdinaryProfit2ndQuarter: '',
      NextYearForecastProfit2ndQuarter: '',
      NextYearForecastEarningsPerShare2ndQuarter: '',
      ForecastOrdinaryProfit: '',
      ForecastProfit: '',
      ForecastEarningsPerShare: '',
      NextYearForecastNetSales: '',
      NextYearForecastOperatingProfit: '',
      NextYearForecastOrdinaryProfit: '',
      NextYearForecastProfit: '',
      NextYearForecastEarningsPerShare: '',
      NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock: '',
      NumberOfTreasuryStockAtTheEndOfFiscalYear: '',
      AverageNumberOfShares: '',
      NonConsolidatedNetSales: '',
      NonConsolidatedOperatingProfit: '',
      NonConsolidatedOrdinaryProfit: '',
      NonConsolidatedProfit: '',
      NonConsolidatedEarningsPerShare: '',
      NonConsolidatedTotalAssets: '',
      NonConsolidatedEquity: '',
      NonConsolidatedEquityToAssetRatio: '',
      NonConsolidatedBookValuePerShare: '',
      ForecastNonConsolidatedNetSales2ndQuarter: '',
      ForecastNonConsolidatedOperatingProfit2ndQuarter: '',
      ForecastNonConsolidatedOrdinaryProfit2ndQuarter: '',
      ForecastNonConsolidatedProfit2ndQuarter: '',
      ForecastNonConsolidatedEarningsPerShare2ndQuarter: '',
      NextYearForecastNonConsolidatedNetSales2ndQuarter: '',
      NextYearForecastNonConsolidatedOperatingProfit2ndQuarter: '',
      NextYearForecastNonConsolidatedOrdinaryProfit2ndQuarter: '',
      NextYearForecastNonConsolidatedProfit2ndQuarter: '',
      NextYearForecastNonConsolidatedEarningsPerShare2ndQuarter: '',
      ForecastNonConsolidatedNetSales: '',
      ForecastNonConsolidatedOperatingProfit: '',
      ForecastNonConsolidatedOrdinaryProfit: '',
      ForecastNonConsolidatedProfit: '',
      ForecastNonConsolidatedEarningsPerShare: '',
      NextYearForecastNonConsolidatedNetSales: '',
      NextYearForecastNonConsolidatedOperatingProfit: '',
      NextYearForecastNonConsolidatedOrdinaryProfit: '',
      NextYearForecastNonConsolidatedProfit: '',
      NextYearForecastNonConsolidatedEarningsPerShare: '',
    } satisfies Omit<
      JQuantsStatement,
      | 'DisclosedDate'
      | 'NetSales'
      | 'OperatingProfit'
      | 'Profit'
      | 'Equity'
      | 'ForecastNetSales'
      | 'ForecastOperatingProfit'
    >;

    const results = normalizeFinancialStatements([
      {
        ...base,
        DisclosedDate: '2023-04-30',
        NetSales: '1000',
        OperatingProfit: '100',
        Profit: '50',
        Equity: '500',
        ForecastNetSales: '4000',
        ForecastOperatingProfit: '400',
      },
      {
        ...base,
        DisclosedDate: '2024-04-30',
        NetSales: '1200',
        OperatingProfit: '180',
        Profit: '72',
        Equity: '600',
        ForecastNetSales: '4200',
        ForecastOperatingProfit: '600',
      },
    ]);

    expect(results[1]).toMatchObject({
      salesYoyPct: 20,
      operatingProfitYoyPct: 80,
      operatingMarginPct: 15,
      operatingMarginPrevPct: 10,
      roePct: 12,
      progressRateOpPct: 30,
      guidanceRevision: 'up',
    });
  });
});

describe('YahooFinanceProvider ticker normalization', () => {
  it('normalizes stock codes and indices to Yahoo Finance format', () => {
    const provider = new YahooFinanceProvider();
    expect(provider.normalizeJapaneseTicker('7203')).toBe('7203.T');
    expect(provider.normalizeJapaneseTicker('NIKKEI225')).toBe('^N225');
    expect(provider.normalizeJapaneseTicker('TOPIX')).toBe('^TOPX');
    expect(provider.normalizeJapaneseTicker('MOTHERS_GROWTH')).toBe('2516.T');
  });
});

describe('DataQualityService additional checks', () => {
  it('detects OHLC price inconsistency issues', () => {
    const service = new DataQualityService();
    const report = service.check({
      symbols: [{ code: '7203', name: 'Toyota', market: 'Prime', sector: 'Automotive', isActive: true, lotSize: 100, marketCapJpy: null }],
      prices: [
        {
          symbolCode: '7203',
          date: '2026-03-25',
          open: 3000,
          high: 2900, // high < open (inconsistent!)
          low: 2800,
          close: 2950,
          volume: 1000,
          turnoverValue: 2950000,
        },
      ],
      financials: [],
      disclosures: [],
      tradingDates: ['2026-03-25'],
    });

    expect(report.totalIssues).toBeGreaterThan(0);
    const ohlcIssue = report.issues.find((i) => i.checkName === 'ohlc_inconsistency');
    expect(ohlcIssue).toBeDefined();
    expect(ohlcIssue?.severity).toBe('error');
  });
});

describe('JPXListedIssueProvider Excel parser', () => {
  it('correctly parses sheets to JPXListedIssue list and pads 4-digit codes', () => {
    // Mock workbook structure
    const workbook = XLSX.utils.book_new();
    const sheetData = [
      ['日付', 'コード', '銘柄名', '市場・商品区分', '33業種コード', '33業種区分'],
      ['20260325', '7203', 'トヨタ自動車', 'プライム', '36', '輸送用機器'],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });

    const provider = new JPXListedIssueProvider();
    const results = provider.parseListedIssuesExcel(buffer);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      code: '72030', // padded
      name: 'トヨタ自動車',
      market: 'プライム',
      sector: '輸送用機器',
    });
  });
});

