import { describe, it, expect } from 'vitest';
import { DataQualityService } from '../services/DataQualityService.js';
import type { DataQualityInput } from '../services/DataQualityService.js';
import type { SymbolData, DailyBar, FinancialResultData, DisclosureData } from '../types/index.js';

// Minimal helpers to build fixture data
function makeSymbol(code: string, isActive = true): SymbolData {
  return {
    code,
    name: `Company ${code}`,
    market: 'プライム',
    sector: '情報・通信業',
    marketCapJpy: 50_000_000_000,
    lotSize: 100,
    isActive,
  };
}

function makeBar(symbolCode: string, date: string): DailyBar {
  return { symbolCode, date, open: 1000, high: 1050, low: 990, close: 1030, volume: 500_000, turnoverValue: 515_000_000 };
}

function makeFinancial(symbolCode: string, announcedAt: string): FinancialResultData {
  return {
    symbolCode,
    announcedAt,
    fiscalPeriod: 'FY2023',
    sales: 10_000_000_000,
    operatingProfit: 1_000_000_000,
    ordinaryProfit: 900_000_000,
    netIncome: 700_000_000,
    salesYoyPct: 5.2,
    operatingProfitYoyPct: 8.1,
    operatingMarginPct: 10.0,
    operatingMarginPrevPct: 9.5,
    roePct: 12.3,
    progressRateOpPct: 95.2,
    guidanceRevision: 'none',
  };
}

function makeDisclosure(symbolCode: string, disclosedAt: string, title: string): DisclosureData {
  return { symbolCode, disclosedAt, disclosureType: 'earnings', title, summary: 'Summary' };
}

const baseInput: DataQualityInput = {
  symbols: [],
  prices: [],
  financials: [],
  disclosures: [],
  tradingDates: [],
};

describe('DataQualityService', () => {
  const svc = new DataQualityService();

  it('returns zero issues for clean data', () => {
    const input: DataQualityInput = {
      ...baseInput,
      symbols: [makeSymbol('1234')],
      prices: [makeBar('1234', '2024-01-15')],
      tradingDates: ['2024-01-15'],
    };
    const report = svc.check(input);
    expect(report.totalIssues).toBe(0);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
  });

  it('detects orphaned prices (prices with no matching symbol)', () => {
    const input: DataQualityInput = {
      ...baseInput,
      symbols: [makeSymbol('1234')],
      prices: [
        makeBar('1234', '2024-01-15'),
        makeBar('9999', '2024-01-15'), // no symbol for 9999
      ],
      tradingDates: ['2024-01-15'],
    };
    const report = svc.check(input);
    const orphanIssues = report.issues.filter((i) => i.checkName === 'orphaned_prices');
    expect(orphanIssues).toHaveLength(1);
    expect(orphanIssues[0]!.symbolCode).toBe('9999');
    expect(orphanIssues[0]!.severity).toBe('error');
  });

  it('detects future financial results when asOfDate is set', () => {
    const input: DataQualityInput = {
      ...baseInput,
      symbols: [makeSymbol('1234')],
      prices: [makeBar('1234', '2024-01-15')],
      financials: [
        makeFinancial('1234', '2024-01-10'), // past — OK
        makeFinancial('1234', '2024-02-01'), // future — should be flagged
      ],
      tradingDates: ['2024-01-15'],
      asOfDate: '2024-01-15',
    };
    const report = svc.check(input);
    const futureIssues = report.issues.filter((i) => i.checkName === 'future_financial_leak');
    expect(futureIssues).toHaveLength(1);
    expect(futureIssues[0]!.symbolCode).toBe('1234');
    expect(futureIssues[0]!.severity).toBe('error');
    expect(futureIssues[0]!.date).toBe('2024-02-01');
  });

  it('does not flag future financials when asOfDate is not provided', () => {
    const input: DataQualityInput = {
      ...baseInput,
      symbols: [makeSymbol('1234')],
      financials: [makeFinancial('1234', '2099-01-01')],
      tradingDates: [],
    };
    const report = svc.check(input);
    const futureIssues = report.issues.filter((i) => i.checkName === 'future_financial_leak');
    expect(futureIssues).toHaveLength(0);
  });

  it('detects duplicate disclosures', () => {
    const disc = makeDisclosure('1234', '2024-01-15', '決算短信');
    const input: DataQualityInput = {
      ...baseInput,
      symbols: [makeSymbol('1234')],
      disclosures: [disc, disc, disc], // same disclosure three times
      tradingDates: [],
    };
    const report = svc.check(input);
    const dupIssues = report.issues.filter((i) => i.checkName === 'duplicate_disclosure');
    expect(dupIssues).toHaveLength(1);
    expect(dupIssues[0]!.symbolCode).toBe('1234');
    expect(dupIssues[0]!.severity).toBe('warning');
  });

  it('does not flag distinct disclosures as duplicates', () => {
    const input: DataQualityInput = {
      ...baseInput,
      symbols: [makeSymbol('1234')],
      disclosures: [
        makeDisclosure('1234', '2024-01-15', '第1四半期決算'),
        makeDisclosure('1234', '2024-04-15', '第2四半期決算'),
      ],
      tradingDates: [],
    };
    const report = svc.check(input);
    const dupIssues = report.issues.filter((i) => i.checkName === 'duplicate_disclosure');
    expect(dupIssues).toHaveLength(0);
  });

  it('report has correct shape: checkedAt is ISO string, counts are consistent', () => {
    const input: DataQualityInput = {
      ...baseInput,
      symbols: [],
      prices: [makeBar('ORPHAN', '2024-01-15')], // one orphan error
      tradingDates: [],
    };
    const report = svc.check(input);
    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.totalIssues).toBe(report.issues.length);
    expect(report.errors).toBe(report.issues.filter((i) => i.severity === 'error').length);
    expect(report.warnings).toBe(report.issues.filter((i) => i.severity === 'warning').length);
  });
});
