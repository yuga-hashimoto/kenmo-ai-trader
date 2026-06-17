import type { DailyBar } from '../types/index.js';

/**
 * Pure, immutable portfolio accounting. The BacktestBrokerAdapter / PaperBroker
 * mirror this logic onto persisted Prisma rows, but the maths lives here so it
 * can be unit-tested without a database.
 */

export interface HeldPosition {
  symbolCode: string;
  quantity: number;
  avgPrice: number;
  strategy: string;
  entryReason: string;
  entryDate: string;
  stopLossPrice: number | null;
  highestPriceSinceEntry: number;
  /** true once the +takeProfit partial has been taken, so it fires only once */
  partialTpDone: boolean;
}

export interface PortfolioState {
  initialCapitalJpy: number;
  cashJpy: number;
  realizedPnlJpy: number;
  peakEquityJpy: number;
  positions: HeldPosition[];
}

export interface ClosedTrade {
  symbolCode: string;
  strategy: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnlJpy: number;
  pnlPct: number;
  holdingDays: number;
  entryReason: string;
  exitReason: string;
}

export function createPortfolio(initialCapitalJpy: number): PortfolioState {
  return {
    initialCapitalJpy,
    cashJpy: initialCapitalJpy,
    realizedPnlJpy: 0,
    peakEquityJpy: initialCapitalJpy,
    positions: [],
  };
}

export interface BuyFillInput {
  symbolCode: string;
  quantity: number;
  executionPrice: number;
  commissionJpy: number;
  strategy: string;
  entryReason: string;
  date: string;
  stopLossPrice: number | null;
}

/** Apply a BUY fill, returning a new portfolio state (no nampin — see risk engine). */
export function applyBuyFill(
  state: PortfolioState,
  fill: BuyFillInput,
): PortfolioState {
  const cost = fill.executionPrice * fill.quantity + fill.commissionJpy;
  const existing = state.positions.find((p) => p.symbolCode === fill.symbolCode);

  let positions: HeldPosition[];
  if (existing) {
    const newQty = existing.quantity + fill.quantity;
    const newAvg =
      (existing.avgPrice * existing.quantity +
        fill.executionPrice * fill.quantity) /
      newQty;
    positions = state.positions.map((p) =>
      p.symbolCode === fill.symbolCode
        ? {
            ...p,
            quantity: newQty,
            avgPrice: newAvg,
            stopLossPrice: fill.stopLossPrice ?? p.stopLossPrice,
            highestPriceSinceEntry: Math.max(
              p.highestPriceSinceEntry,
              fill.executionPrice,
            ),
          }
        : p,
    );
  } else {
    positions = [
      ...state.positions,
      {
        symbolCode: fill.symbolCode,
        quantity: fill.quantity,
        avgPrice: fill.executionPrice,
        strategy: fill.strategy,
        entryReason: fill.entryReason,
        entryDate: fill.date,
        stopLossPrice: fill.stopLossPrice,
        highestPriceSinceEntry: fill.executionPrice,
        partialTpDone: false,
      },
    ];
  }

  return { ...state, cashJpy: state.cashJpy - cost, positions };
}

export interface SellFillInput {
  symbolCode: string;
  quantity: number;
  executionPrice: number;
  commissionJpy: number;
  date: string;
  exitReason: string;
}

export interface SellFillOutput {
  state: PortfolioState;
  closedTrade: ClosedTrade | null;
}

/** Apply a SELL fill (full or partial). Returns new state + a ClosedTrade. */
export function applySellFill(
  state: PortfolioState,
  fill: SellFillInput,
): SellFillOutput {
  const pos = state.positions.find((p) => p.symbolCode === fill.symbolCode);
  if (!pos) return { state, closedTrade: null };

  const sellQty = Math.min(fill.quantity, pos.quantity);
  const proceeds = fill.executionPrice * sellQty - fill.commissionJpy;
  const costBasis = pos.avgPrice * sellQty;
  const pnlJpy = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnlJpy / costBasis) * 100 : 0;

  const remaining = pos.quantity - sellQty;
  const positions =
    remaining > 0
      ? state.positions.map((p) =>
          p.symbolCode === fill.symbolCode ? { ...p, quantity: remaining } : p,
        )
      : state.positions.filter((p) => p.symbolCode !== fill.symbolCode);

  const closedTrade: ClosedTrade = {
    symbolCode: fill.symbolCode,
    strategy: pos.strategy,
    entryDate: pos.entryDate,
    exitDate: fill.date,
    entryPrice: pos.avgPrice,
    exitPrice: fill.executionPrice,
    quantity: sellQty,
    pnlJpy,
    pnlPct,
    holdingDays: diffDays(pos.entryDate, fill.date),
    entryReason: pos.entryReason,
    exitReason: fill.exitReason,
  };

  return {
    state: {
      ...state,
      cashJpy: state.cashJpy + proceeds,
      realizedPnlJpy: state.realizedPnlJpy + pnlJpy,
      positions,
    },
    closedTrade,
  };
}

/** Mark a position's +takeProfit partial as taken (so it won't repeat). */
export function markPartialTpDone(
  state: PortfolioState,
  symbolCode: string,
): PortfolioState {
  return {
    ...state,
    positions: state.positions.map((p) =>
      p.symbolCode === symbolCode ? { ...p, partialTpDone: true } : p,
    ),
  };
}

/** Update the trailing high-water mark for each open position. */
export function updateHighs(
  state: PortfolioState,
  priceByCode: Map<string, number>,
): PortfolioState {
  return {
    ...state,
    positions: state.positions.map((p) => {
      const price = priceByCode.get(p.symbolCode);
      if (price === undefined) return p;
      return {
        ...p,
        highestPriceSinceEntry: Math.max(p.highestPriceSinceEntry, price),
      };
    }),
  };
}

export interface PortfolioSnapshot {
  snapshotDate: string;
  cashJpy: number;
  marketValueJpy: number;
  equityJpy: number;
  realizedPnlJpy: number;
  unrealizedPnlJpy: number;
  totalReturnPct: number;
  drawdownPct: number;
  exposurePct: number;
  positions: Array<{
    symbolCode: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    unrealizedPnlJpy: number;
  }>;
}

/** Mark-to-market the portfolio at a date and produce a snapshot + new peak. */
export function computeSnapshot(
  state: PortfolioState,
  date: string,
  priceByCode: Map<string, number>,
): { snapshot: PortfolioSnapshot; peakEquityJpy: number } {
  let marketValue = 0;
  let unrealized = 0;
  const positions = state.positions.map((p) => {
    const current = priceByCode.get(p.symbolCode) ?? p.avgPrice;
    const value = current * p.quantity;
    const upnl = (current - p.avgPrice) * p.quantity;
    marketValue += value;
    unrealized += upnl;
    return {
      symbolCode: p.symbolCode,
      quantity: p.quantity,
      avgPrice: p.avgPrice,
      currentPrice: current,
      unrealizedPnlJpy: upnl,
    };
  });

  const equity = state.cashJpy + marketValue;
  const peakEquityJpy = Math.max(state.peakEquityJpy, equity);
  const drawdownPct =
    peakEquityJpy > 0 ? ((peakEquityJpy - equity) / peakEquityJpy) * 100 : 0;
  const totalReturnPct =
    state.initialCapitalJpy > 0
      ? ((equity - state.initialCapitalJpy) / state.initialCapitalJpy) * 100
      : 0;
  const exposurePct = equity > 0 ? (marketValue / equity) * 100 : 0;

  return {
    snapshot: {
      snapshotDate: date,
      cashJpy: state.cashJpy,
      marketValueJpy: marketValue,
      equityJpy: equity,
      realizedPnlJpy: state.realizedPnlJpy,
      unrealizedPnlJpy: unrealized,
      totalReturnPct,
      drawdownPct,
      exposurePct,
      positions,
    },
    peakEquityJpy,
  };
}

export function diffDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

export function priceMapFromBars(bars: DailyBar[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const bar of bars) map.set(bar.symbolCode, bar.close);
  return map;
}
