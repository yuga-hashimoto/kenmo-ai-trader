import type {
  AccountState,
  PlaceOrderRequest,
  PositionState,
  RiskConfig,
} from '../types/index.js';

export interface RiskCheckResult {
  ok: boolean;
  rejectionReason: string | null;
  /** computed quantity (lot-adjusted) for accepted buy orders */
  quantity: number;
  /** computed gross cost in JPY for the buy */
  costJpy: number;
}

const reject = (reason: string): RiskCheckResult => ({
  ok: false,
  rejectionReason: reason,
  quantity: 0,
  costJpy: 0,
});

/** Round a raw share count down to the nearest tradeable lot. */
export function lotAdjust(rawQuantity: number, lotSize: number): number {
  if (lotSize <= 0) return Math.floor(rawQuantity);
  return Math.floor(rawQuantity / lotSize) * lotSize;
}

export interface RiskContext {
  account: AccountState;
  positions: PositionState[];
  risk: RiskConfig;
  lotSize: number;
  ordersPlacedToday: number;
  /** reference price used for sizing & exposure (usually the limit price) */
  referencePrice: number;
}

/**
 * Validate a buy/sell order against kenmo risk rules. Pure: it does not touch the
 * DB. The BrokerAdapter persists the rejection reason for rejected orders.
 */
export function checkOrder(
  request: PlaceOrderRequest,
  ctx: RiskContext,
): RiskCheckResult {
  const { account, positions, risk, lotSize, referencePrice } = ctx;

  // --- universal guards ---
  if (!request.reason || request.reason.trim() === '') {
    return reject('reason required');
  }
  if (request.confidence < risk.minConfidenceToTrade) {
    return reject(
      `confidence ${request.confidence} below min ${risk.minConfidenceToTrade}`,
    );
  }
  if (ctx.ordersPlacedToday >= risk.maxOrdersPerDay) {
    return reject('max orders per day reached');
  }

  if (request.side === 'sell') {
    const pos = positions.find((p) => p.symbolCode === request.symbolCode);
    if (!pos || pos.quantity <= 0) return reject('no position to sell');
    return { ok: true, rejectionReason: null, quantity: pos.quantity, costJpy: 0 };
  }

  // --- buy-side guards ---
  if (request.orderType !== 'limit' && !risk.allowMarketBuy) {
    return reject('market buy disabled');
  }
  if (referencePrice <= 0) return reject('invalid reference price');

  // nampin (averaging down) check
  const existing = positions.find((p) => p.symbolCode === request.symbolCode);
  if (existing && existing.quantity > 0 && !risk.allowNampin) {
    if (referencePrice < existing.avgPrice) {
      return reject('nampin disabled (would average down)');
    }
  }

  const budget = request.requestedBudgetJpy ?? 0;
  if (budget <= 0) return reject('invalid budget');

  // single-position cap
  const maxSingleJpy = (account.equityJpy * risk.maxSinglePositionPct) / 100;
  const existingValue = existing
    ? existing.quantity * existing.currentPrice
    : 0;
  if (budget + existingValue > maxSingleJpy + 1) {
    return reject('exceeds max single position');
  }

  // total exposure cap
  const maxExposureJpy = (account.equityJpy * risk.maxTotalExposurePct) / 100;
  if (account.totalExposureJpy + budget > maxExposureJpy + 1) {
    return reject('exceeds max total exposure');
  }

  // buying power: cash (cash account) or leverage-limited (margin account)
  let buyingPower: number;
  if (account.allowMargin) {
    const maxGross = account.equityJpy * risk.maxLeverageIfMarginEnabled;
    buyingPower = maxGross - account.totalExposureJpy;
  } else {
    buyingPower = account.cashJpy;
  }
  if (budget > buyingPower + 1) {
    return reject(
      account.allowMargin ? 'exceeds max leverage' : 'insufficient cash',
    );
  }

  const rawQty = budget / referencePrice;
  const quantity = lotAdjust(rawQty, lotSize);
  if (quantity <= 0) return reject('budget below one lot');

  const costJpy = quantity * referencePrice;
  return { ok: true, rejectionReason: null, quantity, costJpy };
}
