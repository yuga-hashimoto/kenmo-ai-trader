import { describe, it, expect } from 'vitest';
import {
  applyConfigChange,
  applyConfigChanges,
  buildSummaryForAI,
  compareStrategies,
} from '../evolution/evolution.js';
import { DEFAULT_STRATEGY_CONFIG } from '../config/defaults.js';
import type { BacktestSummary } from '../types/index.js';

function summary(overrides: Partial<BacktestSummary> = {}): BacktestSummary {
  return {
    initialCapitalJpy: 1_000_000,
    finalEquityJpy: 1_200_000,
    totalReturnPct: 20,
    annualizedReturnPct: 15,
    maxDrawdownPct: 12,
    winRatePct: 55,
    profitFactor: 1.6,
    tradeCount: 20,
    avgWinPct: 18,
    avgLossPct: -6,
    averageHoldingDays: 14,
    bestTrade: null,
    worstTrade: null,
    monthlyReturns: [],
    ...overrides,
  };
}

describe('evolution engine', () => {
  it('23. applies a dotted config change immutably', () => {
    const next = applyConfigChange(DEFAULT_STRATEGY_CONFIG, {
      path: 'risk.stopLossPct',
      from: 8,
      to: 7,
      rationale: 'tighten',
    });
    expect(next.risk.stopLossPct).toBe(7);
    expect(DEFAULT_STRATEGY_CONFIG.risk.stopLossPct).toBe(8); // unchanged
  });

  it('applies multiple changes', () => {
    const next = applyConfigChanges(DEFAULT_STRATEGY_CONFIG, [
      { path: 'risk.stopLossPct', from: 8, to: 6, rationale: '' },
      { path: 'scoring.minBreakoutScore', from: 60, to: 70, rationale: '' },
    ]);
    expect(next.risk.stopLossPct).toBe(6);
    expect(next.scoring.minBreakoutScore).toBe(70);
  });

  it('builds a BacktestSummaryForAI', () => {
    const forAI = buildSummaryForAI({
      strategyVersion: 'kenmo-v1',
      summary: summary({ maxDrawdownPct: 25, winRatePct: 35, profitFactor: 1.1 }),
      closedTrades: [
        { symbolCode: 'A', strategy: 'earnings_momentum', entryDate: '2022-01-03', exitDate: '2022-02-01', entryPrice: 100, exitPrice: 130, quantity: 100, pnlJpy: 3000, pnlPct: 30, holdingDays: 29, entryReason: '', exitReason: '' },
        { symbolCode: 'B', strategy: 'new_high_breakout', entryDate: '2022-03-03', exitDate: '2022-03-20', entryPrice: 100, exitPrice: 92, quantity: 100, pnlJpy: -800, pnlPct: -8, holdingDays: 17, entryReason: '', exitReason: '' },
      ],
    });
    expect(forAI.recommendationsNeeded.length).toBeGreaterThan(0);
    expect(forAI.bestPatterns.length + forAI.worstPatterns.length).toBe(2);
  });

  it('26. compareStrategies recommends promotion only when genuinely better', () => {
    const champion = summary({ totalReturnPct: 20, maxDrawdownPct: 12, profitFactor: 1.6, tradeCount: 25 });
    const betterChallenger = summary({ totalReturnPct: 30, maxDrawdownPct: 11, profitFactor: 1.8, tradeCount: 25 });
    const overfitChallenger = summary({ totalReturnPct: 80, maxDrawdownPct: 40, profitFactor: 2.0, tradeCount: 4 });

    expect(compareStrategies(champion, betterChallenger).recommendPromote).toBe(true);
    expect(compareStrategies(champion, overfitChallenger).recommendPromote).toBe(false);
  });
});
