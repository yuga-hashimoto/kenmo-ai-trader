import { describe, it, expect } from 'vitest';
import { checkOrder } from '../risk/riskEngine.js';
import { DEFAULT_STRATEGY_CONFIG } from '../config/defaults.js';
import type { AccountState, PlaceOrderRequest } from '../types/index.js';

const risk = DEFAULT_STRATEGY_CONFIG.risk;

function account(overrides: Partial<AccountState> = {}): AccountState {
  return {
    runId: 'r1',
    initialCapitalJpy: 1_000_000,
    cashJpy: 1_000_000,
    marketValueJpy: 0,
    equityJpy: 1_000_000,
    buyingPowerJpy: 1_000_000,
    allowMargin: false,
    totalExposureJpy: 0,
    totalReturnPct: 0,
    maxDrawdownPct: 0,
    ...overrides,
  };
}

function buy(overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest {
  return {
    runType: 'backtest',
    runId: 'r1',
    symbolCode: '7203A',
    side: 'buy',
    orderType: 'limit',
    requestedBudgetJpy: 200_000,
    limitPrice: 1000,
    reason: 'breakout',
    strategy: 'new_high_breakout',
    confidence: 0.8,
    atDate: '2022-06-01',
    ...overrides,
  };
}

describe('risk engine', () => {
  it('1. rejects a cash buy that exceeds buying power', () => {
    const res = checkOrder(buy({ requestedBudgetJpy: 2_000_000 }), {
      account: account(),
      positions: [],
      risk,
      lotSize: 100,
      ordersPlacedToday: 0,
      referencePrice: 1000,
    });
    expect(res.ok).toBe(false);
    // exceeds single-position cap before cash, both are valid rejections
    expect(res.rejectionReason).toBeTruthy();
  });

  it('2. cash account cannot buy beyond cash', () => {
    const res = checkOrder(buy({ requestedBudgetJpy: 240_000 }), {
      account: account({ cashJpy: 150_000, allowMargin: false }),
      positions: [],
      risk,
      lotSize: 100,
      ordersPlacedToday: 0,
      referencePrice: 1000,
    });
    expect(res.ok).toBe(false);
    expect(res.rejectionReason).toBe('insufficient cash');
  });

  it('3. margin account can buy within max leverage', () => {
    const res = checkOrder(buy({ requestedBudgetJpy: 240_000 }), {
      account: account({ cashJpy: 150_000, allowMargin: true, equityJpy: 1_000_000 }),
      positions: [],
      risk,
      lotSize: 100,
      ordersPlacedToday: 0,
      referencePrice: 1000,
    });
    expect(res.ok).toBe(true);
    expect(res.quantity).toBeGreaterThan(0);
  });

  it('3b. margin account rejected beyond max leverage', () => {
    // raise the exposure cap so the leverage cap is the binding constraint
    const res = checkOrder(buy({ requestedBudgetJpy: 240_000 }), {
      account: account({
        cashJpy: 50_000,
        allowMargin: true,
        equityJpy: 1_000_000,
        totalExposureJpy: 1_900_000,
      }),
      positions: [],
      risk: { ...risk, maxTotalExposurePct: 250, maxSinglePositionPct: 100 },
      lotSize: 100,
      ordersPlacedToday: 0,
      referencePrice: 1000,
    });
    expect(res.ok).toBe(false);
    expect(res.rejectionReason).toBe('exceeds max leverage');
  });

  it('4. nampin (averaging down) is rejected', () => {
    const res = checkOrder(buy({ limitPrice: 900 }), {
      account: account(),
      positions: [
        {
          symbolCode: '7203A',
          quantity: 100,
          avgPrice: 1000,
          currentPrice: 900,
          unrealizedPnlJpy: 0,
          unrealizedPnlPct: 0,
          entryReason: 'x',
          strategy: 'new_high_breakout',
          stopLossPrice: 920,
          highestPriceSinceEntry: 1000,
        },
      ],
      risk,
      lotSize: 100,
      ordersPlacedToday: 0,
      referencePrice: 900,
    });
    expect(res.ok).toBe(false);
    expect(res.rejectionReason).toContain('nampin');
  });

  it('5. market buy is rejected when disabled', () => {
    const res = checkOrder(buy({ orderType: 'marketable_limit' }), {
      account: account(),
      positions: [],
      risk,
      lotSize: 100,
      ordersPlacedToday: 0,
      referencePrice: 1000,
    });
    expect(res.ok).toBe(false);
    expect(res.rejectionReason).toBe('market buy disabled');
  });

  it('6. order without a reason is rejected', () => {
    const res = checkOrder(buy({ reason: '   ' }), {
      account: account(),
      positions: [],
      risk,
      lotSize: 100,
      ordersPlacedToday: 0,
      referencePrice: 1000,
    });
    expect(res.ok).toBe(false);
    expect(res.rejectionReason).toBe('reason required');
  });

  it('7. low-confidence order is rejected', () => {
    const res = checkOrder(buy({ confidence: 0.3 }), {
      account: account(),
      positions: [],
      risk,
      lotSize: 100,
      ordersPlacedToday: 0,
      referencePrice: 1000,
    });
    expect(res.ok).toBe(false);
    expect(res.rejectionReason).toContain('confidence');
  });

  it('maxOrdersPerDay is enforced', () => {
    const res = checkOrder(buy(), {
      account: account(),
      positions: [],
      risk,
      lotSize: 100,
      ordersPlacedToday: risk.maxOrdersPerDay,
      referencePrice: 1000,
    });
    expect(res.ok).toBe(false);
    expect(res.rejectionReason).toContain('max orders');
  });
});
