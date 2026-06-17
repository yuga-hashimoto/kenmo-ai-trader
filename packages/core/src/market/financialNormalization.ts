import type { FinancialResultData, GuidanceRevision } from '../types/index.js';
import type { JQuantsStatement } from './JQuantsProvider.js';

export interface NormalizedFinancialResult extends FinancialResultData {
  rawJson: JQuantsStatement;
}

function num(value: string | null | undefined): number {
  if (!value || value.trim() === '' || value.trim() === '-') return 0;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function marginPct(profit: number, sales: number): number {
  return sales === 0 ? 0 : (profit / sales) * 100;
}

function announcedAt(row: JQuantsStatement): string {
  return `${row.DisclosedDate}T${row.DisclosedTime || '15:30'}+09:00`;
}

function fiscalPeriodKey(row: JQuantsStatement): string {
  return row.TypeOfCurrentPeriod || row.CurrentPeriodEndDate || row.CurrentFiscalYearEndDate;
}

function guidanceRevision(row: JQuantsStatement, previous: JQuantsStatement | undefined): GuidanceRevision {
  const doc = row.TypeOfDocument.toLowerCase();
  if (doc.includes('upward') || doc.includes('上方')) return 'up';
  if (doc.includes('downward') || doc.includes('下方')) return 'down';

  if (!previous) return 'none';
  const currentForecast = num(row.ForecastOperatingProfit);
  const previousForecast = num(previous.ForecastOperatingProfit);
  if (currentForecast === 0 || previousForecast === 0) return 'none';
  if (currentForecast > previousForecast) return 'up';
  if (currentForecast < previousForecast) return 'down';
  return 'none';
}

export function normalizeFinancialStatements(rows: JQuantsStatement[]): NormalizedFinancialResult[] {
  const sorted = [...rows].sort((a, b) => announcedAt(a).localeCompare(announcedAt(b)));
  const previousBySymbolPeriod = new Map<string, JQuantsStatement>();
  const latestBySymbol = new Map<string, JQuantsStatement>();

  return sorted.map((row) => {
    const sales = num(row.NetSales);
    const operatingProfit = num(row.OperatingProfit);
    const ordinaryProfit = num(row.OrdinaryProfit);
    const netIncome = num(row.Profit);
    const equity = num(row.Equity);
    const forecastOperatingProfit = num(row.ForecastOperatingProfit);
    const periodKey = `${row.LocalCode}:${fiscalPeriodKey(row)}`;
    const previousSamePeriod = previousBySymbolPeriod.get(periodKey);
    const previousLatest = latestBySymbol.get(row.LocalCode);
    const previousForMargin = previousSamePeriod ?? previousLatest;
    const previousForGuidance = previousLatest;

    const normalized: NormalizedFinancialResult = {
      symbolCode: row.LocalCode,
      announcedAt: announcedAt(row).slice(0, 10),
      fiscalPeriod: fiscalPeriodKey(row),
      sales,
      operatingProfit,
      ordinaryProfit,
      netIncome,
      salesYoyPct: previousSamePeriod ? pct(sales, num(previousSamePeriod.NetSales)) : 0,
      operatingProfitYoyPct: previousSamePeriod
        ? pct(operatingProfit, num(previousSamePeriod.OperatingProfit))
        : 0,
      operatingMarginPct: marginPct(operatingProfit, sales),
      operatingMarginPrevPct: previousForMargin
        ? marginPct(num(previousForMargin.OperatingProfit), num(previousForMargin.NetSales))
        : 0,
      roePct: equity > 0 ? (netIncome / equity) * 100 : 0,
      progressRateOpPct: forecastOperatingProfit !== 0 ? (operatingProfit / forecastOperatingProfit) * 100 : 0,
      guidanceRevision: guidanceRevision(row, previousForGuidance),
      rawJson: row,
    };

    previousBySymbolPeriod.set(periodKey, row);
    latestBySymbol.set(row.LocalCode, row);
    return normalized;
  });
}
