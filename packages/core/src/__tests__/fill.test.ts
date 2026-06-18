import { describe, it, expect } from 'vitest';
import { simulateLimitBuy, simulateLimitSell, simulateStopLossSell, simulateExitAtClose } from '../backtest/fill.js';
import { DEFAULT_STRATEGY_CONFIG } from '../config/defaults.js';
import type { DailyBar } from '../types/index.js';

const risk = DEFAULT_STRATEGY_CONFIG.risk;

function bar(o: number, h: number, l: number, c: number): DailyBar {
  return { symbolCode: 'X', date: '2022-06-01', open: o, high: h, low: l, close: c, volume: 100000, turnoverValue: 100000 * c };
}

describe('fill simulation', () => {
  it('8. limit buy fills when low <= limit', () => {
    const fill = simulateLimitBuy(bar(1010, 1030, 990, 1020), 1000, 100, risk);
    expect(fill.filled).toBe(true);
    // open(1010) > limit(1000), so fills at limit + slippage
    expect(fill.executionPrice).toBeGreaterThanOrEqual(1000);
    expect(fill.commissionJpy).toBeGreaterThan(0);
  });

  it('8b. limit buy fills at the open when open is below the limit (price improvement)', () => {
    const fill = simulateLimitBuy(bar(980, 1005, 970, 1000), 1000, 100, risk);
    expect(fill.filled).toBe(true);
    expect(fill.executionPrice).toBeLessThan(1000 * 1.01); // near 980 + slippage
    expect(fill.executionPrice).toBeGreaterThanOrEqual(980);
  });

  it('9. limit buy does not fill when low > limit', () => {
    const fill = simulateLimitBuy(bar(1050, 1080, 1020, 1060), 1000, 100, risk);
    expect(fill.filled).toBe(false);
  });

  it('10. stop-loss sell triggers when low <= stop', () => {
    const fill = simulateStopLossSell(bar(1000, 1010, 915, 930), 920, 100, risk);
    expect(fill.filled).toBe(true);
    // intraday touch: fills near the stop minus slippage
    expect(fill.executionPrice).toBeLessThanOrEqual(920);
    expect(fill.executionPrice).toBeGreaterThan(900);
  });

  it('11. gap-down fills at the open, not the stop price', () => {
    const fill = simulateStopLossSell(bar(880, 900, 860, 870), 920, 100, risk);
    expect(fill.filled).toBe(true);
    // open (880) is below stop (920) -> fill near open, well below the stop
    expect(fill.executionPrice).toBeLessThan(890);
  });

  it('12/13. exit-at-close fills at close minus slippage', () => {
    const fill = simulateExitAtClose(bar(1000, 1100, 990, 1080), 100, risk);
    expect(fill.filled).toBe(true);
    expect(fill.executionPrice).toBeLessThanOrEqual(1080);
    expect(fill.executionPrice).toBeGreaterThan(1070);
  });

  it('14. limit sell (take-profit) fills when high >= limit, at the limit', () => {
    // high(1120) reaches limit(1100) intraday even though close(1050) is below it
    const fill = simulateLimitSell(bar(1010, 1120, 1000, 1050), 1100, 100, risk);
    expect(fill.filled).toBe(true);
    expect(fill.executionPrice).toBeLessThanOrEqual(1100);
    expect(fill.executionPrice).toBeGreaterThan(1090);
  });

  it('15. limit sell does not fill when the day never reaches the limit', () => {
    const fill = simulateLimitSell(bar(1010, 1080, 1000, 1050), 1100, 100, risk);
    expect(fill.filled).toBe(false);
  });

  it('16. gap-up open above the limit fills at the open (price improvement)', () => {
    const fill = simulateLimitSell(bar(1150, 1180, 1140, 1160), 1100, 100, risk);
    expect(fill.filled).toBe(true);
    expect(fill.executionPrice).toBeGreaterThan(1100); // better than the limit
  });
});
