/**
 * DataQualityService — detects data integrity issues before and during backtests.
 */

import type { DailyBar, FinancialResultData, DisclosureData, SymbolData } from '../types/index.js';

export interface QualityIssue {
  severity: 'error' | 'warning' | 'info';
  checkName: string;
  symbolCode?: string;
  date?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface QualityReport {
  checkedAt: string;
  totalIssues: number;
  errors: number;
  warnings: number;
  issues: QualityIssue[];
}

export interface DataQualityInput {
  symbols: SymbolData[];
  prices: DailyBar[];
  financials: FinancialResultData[];
  disclosures: DisclosureData[];
  tradingDates: string[];
  backtestStart?: string;
  backtestEnd?: string;
  asOfDate?: string;
}

export class DataQualityService {
  check(input: DataQualityInput): QualityReport {
    const issues: QualityIssue[] = [
      ...this.checkOrphanedPrices(input),
      ...this.checkMissingTradingDays(input),
      ...this.checkZeroVolume(input),
      ...this.checkSplitAdjustment(input),
      ...this.checkFutureFinancials(input),
      ...this.checkDelistedSymbols(input),
      ...this.checkTimepointConsistency(input),
      ...this.checkDuplicateDisclosures(input),
      ...this.checkOhlcInconsistencies(input),
      ...this.checkConsecutiveZeroVolume(input),
      ...this.checkTopixProxyMissing(input),
      ...this.checkMissingFinancialsAndCalendar(input),
    ];
    return {
      checkedAt: new Date().toISOString(),
      totalIssues: issues.length,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      issues,
    };
  }

  private checkOrphanedPrices(input: DataQualityInput): QualityIssue[] {
    const symbolCodes = new Set(input.symbols.map((s) => s.code));
    const orphaned = new Set<string>();
    for (const bar of input.prices) {
      if (!symbolCodes.has(bar.symbolCode)) orphaned.add(bar.symbolCode);
    }
    return [...orphaned].map((code) => ({
      severity: 'error' as const,
      checkName: 'orphaned_prices',
      symbolCode: code,
      message: `銘柄マスターに存在しない価格データ: ${code}`,
    }));
  }

  private checkMissingTradingDays(input: DataQualityInput): QualityIssue[] {
    if (input.tradingDates.length === 0) return [];
    const issues: QualityIssue[] = [];
    const from = input.backtestStart ?? input.tradingDates[0]!;
    const to = input.backtestEnd ?? input.tradingDates[input.tradingDates.length - 1]!;
    const expectedDates = input.tradingDates.filter((d) => d >= from && d <= to);
    for (const symbol of input.symbols) {
      if (!symbol.isActive) continue;
      const symbolDates = new Set(
        input.prices.filter((p) => p.symbolCode === symbol.code).map((p) => p.date),
      );
      const missing = expectedDates.filter((d) => !symbolDates.has(d));
      if (missing.length > 5) {
        issues.push({
          severity: 'warning',
          checkName: 'missing_trading_days',
          symbolCode: symbol.code,
          message: `価格データが欠損している営業日: ${symbol.code} (${missing.length}日)`,
          details: { missingDates: missing.slice(0, 10) },
        });
      }
    }
    return issues;
  }

  private checkZeroVolume(input: DataQualityInput): QualityIssue[] {
    const bySymbol = new Map<string, number>();
    for (const b of input.prices.filter((b) => b.volume === 0 && b.close > 0)) {
      bySymbol.set(b.symbolCode, (bySymbol.get(b.symbolCode) ?? 0) + 1);
    }
    return [...bySymbol.entries()]
      .filter(([, count]) => count > 3)
      .map(([code, count]) => ({
        severity: 'warning' as const,
        checkName: 'zero_volume_anomaly',
        symbolCode: code,
        message: `出来高ゼロの異常値: ${code} (${count}件)`,
      }));
  }

  private checkSplitAdjustment(input: DataQualityInput): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const bySymbol = new Map<string, DailyBar[]>();
    for (const bar of input.prices) {
      const arr = bySymbol.get(bar.symbolCode) ?? [];
      arr.push(bar);
      bySymbol.set(bar.symbolCode, arr);
    }
    for (const [code, bars] of bySymbol) {
      const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const curr = sorted[i]!;
        if (prev.close <= 0 || curr.volume === 0) continue;
        const gapPct = (curr.open - prev.close) / prev.close;
        if (Math.abs(gapPct) > 0.3) {
          issues.push({
            severity: 'warning',
            checkName: 'possible_unadjusted_split',
            symbolCode: code,
            date: curr.date,
            message: `株式分割後の調整漏れ疑い: ${code} ${curr.date} (gap ${(gapPct * 100).toFixed(1)}%)`,
          });
        }
      }
    }
    return issues;
  }

  private checkFutureFinancials(input: DataQualityInput): QualityIssue[] {
    if (!input.asOfDate) return [];
    return input.financials
      .filter((f) => f.announcedAt > input.asOfDate!)
      .map((f) => ({
        severity: 'error' as const,
        checkName: 'future_financial_leak',
        symbolCode: f.symbolCode,
        date: f.announcedAt,
        message: `未来情報混入: 決算発表日 ${f.announcedAt} > asOfDate ${input.asOfDate}`,
      }));
  }

  private checkDelistedSymbols(input: DataQualityInput): QualityIssue[] {
    if (!input.backtestEnd) return [];
    return input.symbols
      .filter((s) => !s.isActive)
      .filter((s) =>
        input.prices.some(
          (p) => p.symbolCode === s.code && p.date >= (input.backtestStart ?? ''),
        ),
      )
      .map((s) => ({
        severity: 'warning' as const,
        checkName: 'delisted_symbol_in_backtest',
        symbolCode: s.code,
        message: `上場廃止銘柄がバックテスト期間中に含まれています: ${s.code}`,
      }));
  }

  private checkTimepointConsistency(input: DataQualityInput): QualityIssue[] {
    const priceDates = new Set(input.prices.map((p) => p.date));
    const tradingDateSet = new Set(input.tradingDates);
    const issues: QualityIssue[] = [];
    for (const fin of input.financials) {
      const dateStr = fin.announcedAt.slice(0, 10);
      if (!priceDates.has(dateStr) && tradingDateSet.has(dateStr)) {
        issues.push({
          severity: 'info',
          checkName: 'financial_date_no_price',
          symbolCode: fin.symbolCode,
          date: dateStr,
          message: `決算発表日に価格データなし: ${fin.symbolCode} ${dateStr}`,
        });
      }
    }
    return issues;
  }

  private checkDuplicateDisclosures(input: DataQualityInput): QualityIssue[] {
    const seen = new Map<string, number>();
    for (const d of input.disclosures) {
      const key = `${d.symbolCode}|${d.disclosedAt}|${d.title}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => {
        const [symbolCode] = key.split('|');
        return {
          severity: 'warning' as const,
          checkName: 'duplicate_disclosure',
          symbolCode,
          message: `同じ開示の重複保存: ${key} (${count}件)`,
        };
      });
  }

  private checkOhlcInconsistencies(input: DataQualityInput): QualityIssue[] {
    const issues: QualityIssue[] = [];
    for (const p of input.prices) {
      if (p.high < p.low || p.high < p.close || p.low > p.close || p.open > p.high || p.open < p.low) {
        issues.push({
          severity: 'error',
          checkName: 'ohlc_inconsistency',
          symbolCode: p.symbolCode,
          date: p.date,
          message: `OHLC不整合: open=${p.open}, high=${p.high}, low=${p.low}, close=${p.close} (${p.symbolCode} ${p.date})`,
        });
      }
    }
    return issues;
  }

  private checkConsecutiveZeroVolume(input: DataQualityInput): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const bySymbol = new Map<string, DailyBar[]>();
    for (const bar of input.prices) {
      const arr = bySymbol.get(bar.symbolCode) ?? [];
      arr.push(bar);
      bySymbol.set(bar.symbolCode, arr);
    }
    for (const [code, bars] of bySymbol) {
      const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
      let zeroCount = 0;
      for (const bar of sorted) {
        if (bar.volume === 0) {
          zeroCount++;
          if (zeroCount >= 10) {
            issues.push({
              severity: 'warning',
              checkName: 'consecutive_zero_volume',
              symbolCode: code,
              date: bar.date,
              message: `10日以上連続で出来高0: ${code} ${bar.date}まで`,
            });
            break;
          }
        } else {
          zeroCount = 0;
        }
      }
    }
    return issues;
  }

  private checkTopixProxyMissing(input: DataQualityInput): QualityIssue[] {
    const hasTopix = input.prices.some((p) => p.symbolCode === 'TOPIX' || p.symbolCode === '^TOPX');
    if (!hasTopix && input.tradingDates.length > 0) {
      return [
        {
          severity: 'warning',
          checkName: 'topix_proxy_missing',
          message: 'TOPIX指数の価格データが存在しません。一部の戦略/市場レジームフィルターが正常に動作しない可能性があります。',
        },
      ];
    }
    return [];
  }

  private checkMissingFinancialsAndCalendar(input: DataQualityInput): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const financialsSet = new Set(input.financials.map((f) => f.symbolCode));
    for (const symbol of input.symbols) {
      if (symbol.isActive && !financialsSet.has(symbol.code)) {
        issues.push({
          severity: 'warning',
          checkName: 'missing_financials',
          symbolCode: symbol.code,
          message: `財務諸表データが欠損しています: ${symbol.code}`,
        });
      }
    }
    return issues;
  }
}
