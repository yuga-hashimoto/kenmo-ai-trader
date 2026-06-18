import type { DailyBar, OrderSide, RiskConfig } from '../types/index.js';

export interface FillResult {
  filled: boolean;
  executionPrice: number;
  commissionJpy: number;
  slippageJpy: number;
  /** quantity actually filled (may be capped by liquidity / participation) */
  filledQuantity: number;
}

/** Cap an order quantity to a fraction of the day's volume (板/流動性 participation limit). */
export function participationCap(
  requestedQuantity: number,
  dayVolume: number,
  maxParticipationRate = 0.1,
): number {
  const cap = Math.floor(dayVolume * maxParticipationRate);
  return Math.max(0, Math.min(requestedQuantity, cap));
}

const NO_FILL: FillResult = {
  filled: false,
  executionPrice: 0,
  commissionJpy: 0,
  slippageJpy: 0,
  filledQuantity: 0,
};

function commission(notional: number, risk: RiskConfig): number {
  return Math.round((notional * risk.commissionBps) / 10_000);
}

function slippage(notional: number, risk: RiskConfig): number {
  return Math.round((notional * risk.slippageBps) / 10_000);
}

/**
 * Simulate a limit BUY against a single day's OHLCV bar.
 *
 * Rules (per spec):
 *  - fills only if the day's low <= limit price
 *  - if the day's open is already below the limit, fill at the open (price improvement)
 *  - otherwise fill at the limit price
 *  - slippage is added to the buy price (worse for the buyer); commission added on top
 */
export function simulateLimitBuy(
  bar: DailyBar,
  limitPrice: number,
  quantity: number,
  risk: RiskConfig,
): FillResult {
  if (quantity <= 0 || limitPrice <= 0) return NO_FILL;
  if (bar.low > limitPrice) return NO_FILL;

  const basePrice = bar.open < limitPrice ? bar.open : limitPrice;
  const slipPerShare = (basePrice * risk.slippageBps) / 10_000;
  const executionPrice = basePrice + slipPerShare;
  const notional = executionPrice * quantity;
  return {
    filled: true,
    executionPrice,
    commissionJpy: commission(notional, risk),
    slippageJpy: Math.round(slipPerShare * quantity),
    filledQuantity: quantity,
  };
}

/**
 * Simulate a stop-loss SELL against a single day's bar.
 *
 *  - triggers if the day's low <= stop price
 *  - on a gap-down (open <= stop) it fills at the OPEN, not the stop price
 *  - otherwise fills at the stop price
 *  - slippage is subtracted from the sell price (worse for the seller)
 */
export function simulateStopLossSell(
  bar: DailyBar,
  stopPrice: number,
  quantity: number,
  risk: RiskConfig,
): FillResult {
  if (quantity <= 0 || stopPrice <= 0) return NO_FILL;
  if (bar.low > stopPrice) return NO_FILL;

  const basePrice = bar.open <= stopPrice ? bar.open : stopPrice;
  const slipPerShare = (basePrice * risk.slippageBps) / 10_000;
  const executionPrice = Math.max(0, basePrice - slipPerShare);
  const notional = executionPrice * quantity;
  return {
    filled: true,
    executionPrice,
    commissionJpy: commission(notional, risk),
    slippageJpy: Math.round(slipPerShare * quantity),
    filledQuantity: quantity,
  };
}

/**
 * Standing limit SELL at a target price (e.g. take-profit). Fills only if the
 * day's high reaches the limit; a gap-up open above the limit fills at the open
 * (better), otherwise at the limit. Models a resting order that triggers
 * intraday — the upside mirror of simulateStopLossSell.
 */
export function simulateLimitSell(
  bar: DailyBar,
  limitPrice: number,
  quantity: number,
  risk: RiskConfig,
): FillResult {
  if (quantity <= 0 || limitPrice <= 0) return NO_FILL;
  if (bar.high < limitPrice) return NO_FILL;

  const basePrice = bar.open >= limitPrice ? bar.open : limitPrice;
  const slipPerShare = (basePrice * risk.slippageBps) / 10_000;
  const executionPrice = Math.max(0, basePrice - slipPerShare);
  const notional = executionPrice * quantity;
  return {
    filled: true,
    executionPrice,
    commissionJpy: commission(notional, risk),
    slippageJpy: Math.round(slipPerShare * quantity),
    filledQuantity: quantity,
  };
}

/**
 * Simulate a market-ish exit (take-profit, trailing-stop, MA-break, discretionary
 * AI sell). Fills at the day's close minus slippage. Used for non-stop exits where
 * we approximate execution at the closing auction.
 */
export function simulateExitAtClose(
  bar: DailyBar,
  quantity: number,
  risk: RiskConfig,
): FillResult {
  if (quantity <= 0) return NO_FILL;
  const slipPerShare = (bar.close * risk.slippageBps) / 10_000;
  const executionPrice = Math.max(0, bar.close - slipPerShare);
  const notional = executionPrice * quantity;
  return {
    filled: true,
    executionPrice,
    commissionJpy: commission(notional, risk),
    slippageJpy: Math.round(slipPerShare * quantity),
    filledQuantity: quantity,
  };
}

export function commissionFor(
  side: OrderSide,
  price: number,
  quantity: number,
  risk: RiskConfig,
): number {
  void side;
  return commission(price * quantity, risk);
}
