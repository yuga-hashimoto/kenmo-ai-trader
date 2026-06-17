import { describe, it, expect } from 'vitest';
import {
  applyBuyFill,
  applySellFill,
  computeSnapshot,
  createPortfolio,
} from '../portfolio/accounting.js';

describe('portfolio accounting', () => {
  it('14/17. buy fill reduces cash and creates a position; snapshot marks unrealized PnL', () => {
    let p = createPortfolio(1_000_000);
    p = applyBuyFill(p, {
      symbolCode: 'X',
      quantity: 100,
      executionPrice: 1000,
      commissionJpy: 50,
      strategy: 'new_high_breakout',
      entryReason: 'r',
      date: '2022-06-01',
      stopLossPrice: 920,
    });
    expect(p.cashJpy).toBe(1_000_000 - 100_000 - 50);
    expect(p.positions).toHaveLength(1);

    const { snapshot } = computeSnapshot(p, '2022-06-02', new Map([['X', 1100]]));
    expect(snapshot.marketValueJpy).toBe(110_000);
    expect(snapshot.unrealizedPnlJpy).toBe(10_000);
    expect(snapshot.equityJpy).toBeCloseTo(p.cashJpy + 110_000, 0);
  });

  it('16. sell fill realizes PnL correctly', () => {
    let p = createPortfolio(1_000_000);
    p = applyBuyFill(p, {
      symbolCode: 'X',
      quantity: 100,
      executionPrice: 1000,
      commissionJpy: 0,
      strategy: 's',
      entryReason: 'r',
      date: '2022-06-01',
      stopLossPrice: null,
    });
    const { state, closedTrade } = applySellFill(p, {
      symbolCode: 'X',
      quantity: 100,
      executionPrice: 1200,
      commissionJpy: 0,
      date: '2022-06-10',
      exitReason: 'take_profit',
    });
    expect(closedTrade).not.toBeNull();
    expect(closedTrade!.pnlJpy).toBe(20_000);
    expect(closedTrade!.pnlPct).toBeCloseTo(20, 5);
    expect(state.realizedPnlJpy).toBe(20_000);
    expect(state.positions).toHaveLength(0);
  });

  it('partial sell keeps remaining position', () => {
    let p = createPortfolio(1_000_000);
    p = applyBuyFill(p, {
      symbolCode: 'X',
      quantity: 100,
      executionPrice: 1000,
      commissionJpy: 0,
      strategy: 's',
      entryReason: 'r',
      date: '2022-06-01',
      stopLossPrice: null,
    });
    const { state, closedTrade } = applySellFill(p, {
      symbolCode: 'X',
      quantity: 25,
      executionPrice: 1200,
      commissionJpy: 0,
      date: '2022-06-10',
      exitReason: 'take_profit',
    });
    expect(closedTrade!.quantity).toBe(25);
    expect(state.positions[0]!.quantity).toBe(75);
  });

  it('15. snapshot drawdown grows after a peak', () => {
    let p = createPortfolio(1_000_000);
    p = applyBuyFill(p, {
      symbolCode: 'X',
      quantity: 100,
      executionPrice: 1000,
      commissionJpy: 0,
      strategy: 's',
      entryReason: 'r',
      date: '2022-06-01',
      stopLossPrice: null,
    });
    const up = computeSnapshot(p, '2022-06-02', new Map([['X', 1300]]));
    p = { ...p, peakEquityJpy: up.peakEquityJpy };
    const down = computeSnapshot(p, '2022-06-03', new Map([['X', 1100]]));
    expect(down.snapshot.drawdownPct).toBeGreaterThan(0);
  });
});
