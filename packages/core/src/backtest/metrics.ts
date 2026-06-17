import type { BacktestSummary, TradeResult } from '../types/index.js';
import type { ClosedTrade, PortfolioSnapshot } from '../portfolio/accounting.js';

/** Max drawdown (%) over an equity curve. */
export function maxDrawdownPct(equityCurve: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const eq of equityCurve) {
    peak = Math.max(peak, eq);
    if (peak > 0) {
      const dd = ((peak - eq) / peak) * 100;
      maxDd = Math.max(maxDd, dd);
    }
  }
  return maxDd;
}

export function profitFactor(trades: ClosedTrade[]): number {
  const grossWin = trades
    .filter((t) => t.pnlJpy > 0)
    .reduce((acc, t) => acc + t.pnlJpy, 0);
  const grossLoss = trades
    .filter((t) => t.pnlJpy < 0)
    .reduce((acc, t) => acc + Math.abs(t.pnlJpy), 0);
  // Cap at a large finite value: Infinity serializes to null in JSON/DB.
  if (grossLoss === 0) return grossWin > 0 ? 999 : 0;
  return grossWin / grossLoss;
}

export function annualizedReturnPct(
  totalReturnPct: number,
  startDate: string,
  endDate: string,
): number {
  const days =
    (new Date(endDate + 'T00:00:00Z').getTime() -
      new Date(startDate + 'T00:00:00Z').getTime()) /
    86_400_000;
  const years = Math.max(days / 365, 1 / 365);
  const growth = 1 + totalReturnPct / 100;
  if (growth <= 0) return -100;
  return (Math.pow(growth, 1 / years) - 1) * 100;
}

export function monthlyReturns(
  snapshots: PortfolioSnapshot[],
): Array<{ month: string; returnPct: number }> {
  if (snapshots.length === 0) return [];
  const byMonthEnd = new Map<string, PortfolioSnapshot>();
  for (const s of snapshots) {
    const month = s.snapshotDate.slice(0, 7);
    byMonthEnd.set(month, s); // snapshots ascending -> last wins = month end
  }
  const months = [...byMonthEnd.keys()].sort();
  const result: Array<{ month: string; returnPct: number }> = [];
  let prevEquity = snapshots[0]!.equityJpy;
  for (const month of months) {
    const eq = byMonthEnd.get(month)!.equityJpy;
    const ret = prevEquity > 0 ? ((eq - prevEquity) / prevEquity) * 100 : 0;
    result.push({ month, returnPct: ret });
    prevEquity = eq;
  }
  return result;
}

function toTradeResult(t: ClosedTrade): TradeResult {
  return {
    symbolCode: t.symbolCode,
    strategy: t.strategy,
    entryDate: t.entryDate,
    exitDate: t.exitDate,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    quantity: t.quantity,
    pnlJpy: t.pnlJpy,
    pnlPct: t.pnlPct,
    holdingDays: t.holdingDays,
  };
}

export function computeBacktestSummary(params: {
  initialCapitalJpy: number;
  startDate: string;
  endDate: string;
  snapshots: PortfolioSnapshot[];
  closedTrades: ClosedTrade[];
}): BacktestSummary {
  const { initialCapitalJpy, startDate, endDate, snapshots, closedTrades } =
    params;
  const finalEquityJpy =
    snapshots.length > 0
      ? snapshots[snapshots.length - 1]!.equityJpy
      : initialCapitalJpy;
  const totalReturnPct =
    initialCapitalJpy > 0
      ? ((finalEquityJpy - initialCapitalJpy) / initialCapitalJpy) * 100
      : 0;

  const wins = closedTrades.filter((t) => t.pnlJpy > 0);
  const losses = closedTrades.filter((t) => t.pnlJpy <= 0);
  const winRatePct =
    closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const avgWinPct =
    wins.length > 0 ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct =
    losses.length > 0
      ? losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length
      : 0;
  const averageHoldingDays =
    closedTrades.length > 0
      ? closedTrades.reduce((a, t) => a + t.holdingDays, 0) / closedTrades.length
      : 0;

  const sorted = [...closedTrades].sort((a, b) => b.pnlJpy - a.pnlJpy);
  const bestTrade = sorted.length > 0 ? toTradeResult(sorted[0]!) : null;
  const worstTrade =
    sorted.length > 0 ? toTradeResult(sorted[sorted.length - 1]!) : null;

  return {
    initialCapitalJpy,
    finalEquityJpy,
    totalReturnPct,
    annualizedReturnPct: annualizedReturnPct(totalReturnPct, startDate, endDate),
    maxDrawdownPct: maxDrawdownPct(snapshots.map((s) => s.equityJpy)),
    winRatePct,
    profitFactor: profitFactor(closedTrades),
    tradeCount: closedTrades.length,
    avgWinPct,
    avgLossPct,
    averageHoldingDays,
    bestTrade,
    worstTrade,
    monthlyReturns: monthlyReturns(snapshots),
  };
}
