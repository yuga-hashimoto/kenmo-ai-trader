/**
 * CSV data importer — loads CSV files into structured data for DB ingestion.
 * Used when API keys are unavailable: import historical data from CSV exports.
 */

import type { DailyBar, FinancialResultData, DisclosureData, SymbolData } from '../types/index.js';
import type { GuidanceRevision } from '../types/index.js';
import { parse } from 'csv-parse/sync';

export interface ImportedSymbol extends SymbolData {}

export interface ImportedIndexPrice {
  indexCode: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ImportedMarginRow {
  symbolCode: string;
  date: string;
  marginBuyQty?: number;
  marginSellQty?: number;
  marginBuyValue?: number;
  marginSellValue?: number;
}

export interface ImportedShortSellingRow {
  symbolCode: string;
  reportDate: string;
  shortPositionQty?: number;
  shortPositionPct?: number;
  holderName?: string;
}

export class CsvDataImporter {
  private static parseRows(csv: string): string[][] {
    return parse(csv, {
      bom: true,
      columns: false,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: false,
    }) as string[][];
  }

  private static parseNum(s: string | undefined): number | undefined {
    if (!s || s.trim() === '' || s.trim() === '-') return undefined;
    return Number(s.trim());
  }

  private static parseDate(s: string | undefined): string {
    if (!s) return '';
    return s.trim().slice(0, 10);
  }

  static importSymbolsCsv(csv: string): ImportedSymbol[] {
    const rows = CsvDataImporter.parseRows(csv).slice(1);
    return rows
      .map((cols) => {
        return {
          code: cols[0]?.trim() ?? '',
          name: cols[1]?.trim() ?? '',
          market: cols[2]?.trim() ?? '',
          sector: cols[3]?.trim() ?? '',
          marketCapJpy: CsvDataImporter.parseNum(cols[4]) ?? null,
          lotSize: Number(cols[5]?.trim() ?? '100') || 100,
          isActive: (cols[6]?.trim() ?? 'true') !== 'false',
        };
      })
      .filter((s) => s.code);
  }

  static importDailyPricesCsv(csv: string): DailyBar[] {
    const rows = CsvDataImporter.parseRows(csv).slice(1);
    return rows
      .map((cols) => {
        return {
          symbolCode: cols[0]?.trim() ?? '',
          date: CsvDataImporter.parseDate(cols[1]),
          open: Number(cols[2] ?? 0),
          high: Number(cols[3] ?? 0),
          low: Number(cols[4] ?? 0),
          close: Number(cols[5] ?? 0),
          volume: Number(cols[6] ?? 0),
          turnoverValue: Number(cols[7] ?? 0),
        };
      })
      .filter((b) => b.symbolCode && b.date);
  }

  static importFinancialStatementsCsv(csv: string): FinancialResultData[] {
    const rows = CsvDataImporter.parseRows(csv).slice(1);
    return rows
      .map((cols) => {
        const guidanceRaw = cols[13]?.trim() ?? 'none';
        const guidanceRevision: GuidanceRevision =
          guidanceRaw === 'up' || guidanceRaw === 'down' ? guidanceRaw : 'none';
        return {
          symbolCode: cols[0]?.trim() ?? '',
          announcedAt: CsvDataImporter.parseDate(cols[1]),
          fiscalPeriod: cols[2]?.trim() ?? '',
          sales: Number(cols[3] ?? 0),
          operatingProfit: Number(cols[4] ?? 0),
          ordinaryProfit: Number(cols[5] ?? 0),
          netIncome: Number(cols[6] ?? 0),
          salesYoyPct: Number(cols[7] ?? 0),
          operatingProfitYoyPct: Number(cols[8] ?? 0),
          operatingMarginPct: Number(cols[9] ?? 0),
          operatingMarginPrevPct: Number(cols[10] ?? 0),
          roePct: Number(cols[11] ?? 0),
          progressRateOpPct: Number(cols[12] ?? 0),
          guidanceRevision,
        };
      })
      .filter((f) => f.symbolCode && f.announcedAt);
  }

  static importDisclosuresCsv(csv: string): DisclosureData[] {
    const rows = CsvDataImporter.parseRows(csv).slice(1);
    return rows
      .map((cols) => {
        return {
          symbolCode: cols[0]?.trim() ?? '',
          disclosedAt: CsvDataImporter.parseDate(cols[1]),
          disclosureType: (cols[2]?.trim() ?? 'other') as DisclosureData['disclosureType'],
          title: cols[3]?.trim() ?? '',
          summary: cols[4]?.trim() ?? '',
        };
      })
      .filter((d) => d.symbolCode && d.disclosedAt);
  }

  static importIndexPricesCsv(csv: string): ImportedIndexPrice[] {
    const rows = CsvDataImporter.parseRows(csv).slice(1);
    return rows
      .map((cols) => {
        return {
          indexCode: cols[0]?.trim() ?? '',
          date: CsvDataImporter.parseDate(cols[1]),
          open: Number(cols[2] ?? 0),
          high: Number(cols[3] ?? 0),
          low: Number(cols[4] ?? 0),
          close: Number(cols[5] ?? 0),
          volume: CsvDataImporter.parseNum(cols[6]),
        };
      })
      .filter((p) => p.indexCode && p.date);
  }

  static importMarginCsv(csv: string): ImportedMarginRow[] {
    const rows = CsvDataImporter.parseRows(csv).slice(1);
    return rows
      .map((cols) => {
        return {
          symbolCode: cols[0]?.trim() ?? '',
          date: CsvDataImporter.parseDate(cols[1]),
          marginBuyQty: CsvDataImporter.parseNum(cols[2]),
          marginSellQty: CsvDataImporter.parseNum(cols[3]),
          marginBuyValue: CsvDataImporter.parseNum(cols[4]),
          marginSellValue: CsvDataImporter.parseNum(cols[5]),
        };
      })
      .filter((r) => r.symbolCode && r.date);
  }

  static importShortSellingCsv(csv: string): ImportedShortSellingRow[] {
    const rows = CsvDataImporter.parseRows(csv).slice(1);
    return rows
      .map((cols) => {
        return {
          symbolCode: cols[0]?.trim() ?? '',
          reportDate: CsvDataImporter.parseDate(cols[1]),
          shortPositionQty: CsvDataImporter.parseNum(cols[2]),
          shortPositionPct: CsvDataImporter.parseNum(cols[3]),
          holderName: cols[4]?.trim(),
        };
      })
      .filter((r) => r.symbolCode && r.reportDate);
  }
}

export function assertKnownDailyPriceSymbols(rows: DailyBar[], knownCodes: Iterable<string>): void {
  const codes = [...new Set(rows.map((r) => r.symbolCode).filter(Boolean))];
  if (codes.length === 0) return;
  const known = new Set(knownCodes);
  if (known.size === 0) {
    throw new Error('daily_prices requires listed_issue_master first. Fetch or import listed_issue_master before daily_prices.');
  }
  const missing = codes.filter((code) => !known.has(code));
  if (missing.length > 0) {
    throw new Error(`daily_prices contains unknown symbols: ${missing.slice(0, 10).join(', ')}. Fetch listed_issue_master first.`);
  }
}
