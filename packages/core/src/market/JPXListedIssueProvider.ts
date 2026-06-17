import XLSX from 'xlsx';
import type { SymbolData } from '../types/index.js';

export interface JPXListedIssue {
  code: string;       // e.g. "7203"
  name: string;       // e.g. "トヨタ自動車"
  market: string;     // e.g. "プライム"
  sector: string;     // e.g. "輸送用機器"
}

export class JPXListedIssueProvider {
  private readonly defaultUrl = 'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls';

  constructor() {}

  async fetchListedIssuesExcel(url?: string): Promise<Buffer> {
    const targetUrl = url || this.defaultUrl;
    const res = await fetch(targetUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch JPX listed issues from ${targetUrl} -> ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  parseListedIssuesExcel(buffer: Buffer): JPXListedIssue[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('Workbook contains no sheets');
    }
    const worksheet = workbook.Sheets[sheetName]!;
    // Raw array of arrays
    const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
    
    const issues: JPXListedIssue[] = [];
    
    // JPX Excel has headers. We look for rows that have a numeric-like symbol code in column 1 (B)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 4) continue;
      
      const rawCode = String(row[1] || '').trim();
      const name = String(row[2] || '').trim();
      const market = String(row[3] || '').trim();
      const sector = String(row[5] || '').trim(); // 33業種区分
      
      // J-Quants formats code as "72030" or similar, but on yfinance/JPX Excel it's "7203".
      // We normalize code: if it's 4 digits, we append "0" to match J-Quants symbol mapping if needed.
      // But user rule states "7203 -> 7203.T", meaning codes in Symbol table might be just "7203" or "72030".
      // Let's check JQuantsProvider.ts or other parts of the system.
      // JQuantsProvider returns Code: row.Code (which is 5 digits like "72030" or "7203").
      // Actually, J-Quants Code represents standard JPX 5-digit code.
      // If code is "7203" (4 digits), we pad it with "0" to "72030" if that's what the database expects,
      // or we keep it as "7203". Let's check JQuantsProvider's getSymbols output mapping.
      // Let's check CsvDataImporter or JQuantsProvider to see code format.
      // In JQuantsMarketDataProvider: "code: r.Code" (Code is 5-digit).
      // Let's check: J-Quants symbol list lists "72030".
      // We will match J-Quants format: if length is 4, pad it with "0".
      // We should check what the codebase uses for Symbol.code.
      // If code is 4 digits, we pad it with "0". e.g. "7203" -> "72030".
      // Because yfinance converts: "72030" -> slice(0, 4) -> "7203" -> "7203.T".
      // Let's check: yfinance provider code conversion "toYahooTicker":
      // if (symbol.length === 5 && symbol.endsWith('0')) ticker = symbol.slice(0, 4) + '.T'
      // In JQuantsProvider we mapped row.Code to Symbol.code, which is 5 digits.
      // So pad code with "0" if it is 4 digits.
      if (/^\d{4}$/.test(rawCode)) {
        const code = rawCode + '0';
        issues.push({ code, name, market, sector });
      } else if (/^\d{5}$/.test(rawCode)) {
        issues.push({ code: rawCode, name, market, sector });
      }
    }
    
    return issues;
  }

  async importListedIssuesFromUrl(url: string): Promise<JPXListedIssue[]> {
    const buffer = await this.fetchListedIssuesExcel(url);
    return this.parseListedIssuesExcel(buffer);
  }

  async importListedIssuesFromFile(filePath: string): Promise<JPXListedIssue[]> {
    // Read file as buffer
    const fs = await import('node:fs/promises');
    const buffer = await fs.readFile(filePath);
    return this.parseListedIssuesExcel(buffer);
  }
}
