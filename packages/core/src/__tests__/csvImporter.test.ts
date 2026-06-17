import { describe, it, expect } from 'vitest';
import { CsvDataImporter } from '../market/CsvDataImporter.js';

describe('CsvDataImporter', () => {
  describe('importDailyPricesCsv', () => {
    it('parses basic CSV correctly', () => {
      const csv = `symbolCode,date,open,high,low,close,volume,turnoverValue
1234,2024-01-15,1000,1050,990,1030,500000,515000000
5678,2024-01-15,500,520,495,510,200000,102000000`;
      const rows = CsvDataImporter.importDailyPricesCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.symbolCode).toBe('1234');
      expect(rows[0]!.close).toBe(1030);
      expect(rows[1]!.symbolCode).toBe('5678');
    });

    it('skips rows without symbolCode or date', () => {
      const csv = `symbolCode,date,open,high,low,close,volume,turnoverValue
,2024-01-15,1000,1050,990,1030,500000,515000000
1234,,1000,1050,990,1030,500000,515000000`;
      const rows = CsvDataImporter.importDailyPricesCsv(csv);
      expect(rows).toHaveLength(0);
    });
  });

  describe('importDisclosuresCsv', () => {
    it('handles quoted fields with commas', () => {
      const csv = `symbolCode,disclosedAt,disclosureType,title,summary
1234,2024-01-15,earnings,"売上高、営業利益の増加","当期の業績は好調で、売上高が前年比10%増加しました"`;
      const rows = CsvDataImporter.importDisclosuresCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.title).toBe('売上高、営業利益の増加');
      expect(rows[0]!.summary).toBe('当期の業績は好調で、売上高が前年比10%増加しました');
    });

    it('handles double-escaped quotes in fields', () => {
      const csv = `symbolCode,disclosedAt,disclosureType,title,summary
1234,2024-01-15,other,"He said ""hello""","Summary"`;
      const rows = CsvDataImporter.importDisclosuresCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.title).toBe('He said "hello"');
    });
  });

  describe('importSymbolsCsv', () => {
    it('parses symbol master correctly', () => {
      const csv = `code,name,market,sector,marketCapJpy,lotSize,isActive
1234,テスト株式会社,プライム,情報・通信業,50000000000,100,true
5678,サンプル商事,スタンダード,卸売業,,1000,false`;
      const rows = CsvDataImporter.importSymbolsCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.code).toBe('1234');
      expect(rows[0]!.name).toBe('テスト株式会社');
      expect(rows[1]!.isActive).toBe(false);
      expect(rows[1]!.lotSize).toBe(1000);
    });
  });

  describe('importFinancialStatementsCsv', () => {
    it('parses financial data with guidanceRevision', () => {
      const csv = `symbolCode,announcedAt,fiscalPeriod,sales,operatingProfit,ordinaryProfit,netIncome,salesYoyPct,operatingProfitYoyPct,operatingMarginPct,operatingMarginPrevPct,roePct,progressRateOpPct,guidanceRevision
1234,2024-01-31,FY2023,10000000000,1000000000,900000000,700000000,5.2,8.1,10.0,9.5,12.3,95.2,up`;
      const rows = CsvDataImporter.importFinancialStatementsCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.guidanceRevision).toBe('up');
      expect(rows[0]!.salesYoyPct).toBe(5.2);
    });
  });
});
