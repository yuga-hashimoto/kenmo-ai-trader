import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  CsvDataImporter,
  JQuantsProvider,
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
