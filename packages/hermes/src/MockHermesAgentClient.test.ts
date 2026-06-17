import { describe, it, expect } from 'vitest';
import { MockHermesAgentClient } from './MockHermesAgentClient.js';
import { DEFAULT_STRATEGY_CONFIG } from '@kenmo/core';
import type { AgentTaskContext, Candidate } from '@kenmo/core';

const r = DEFAULT_STRATEGY_CONFIG.risk;

function baseContext(overrides: Partial<AgentTaskContext> = {}): AgentTaskContext {
  return {
    backtestTime: '2022-06-01T09:05:00+09:00',
    mode: 'backtest',
    taskType: 'monitor_and_trade',
    account: {
      initialCapitalJpy: 1_000_000,
      cashJpy: 1_000_000,
      equityJpy: 1_000_000,
      buyingPowerJpy: 1_000_000,
      allowMargin: false,
      totalExposureJpy: 0,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
    },
    riskRules: {
      maxSinglePositionPct: r.maxSinglePositionPct,
      maxTotalExposurePct: r.maxTotalExposurePct,
      stopLossPct: r.stopLossPct,
      takeProfitPct: r.takeProfitPct,
      trailingStopPct: r.trailingStopPct,
      allowNampin: r.allowNampin,
      allowMarketBuy: r.allowMarketBuy,
      minConfidenceToTrade: r.minConfidenceToTrade,
    },
    positions: [],
    candidates: [],
    marketRegime: { indexTrend: 'up', riskOn: true, comment: '' },
    ...overrides,
  };
}

function candidate(score: number): Candidate {
  return {
    symbol: '6501B',
    name: 'Beta Tech',
    market: 'TSE Growth',
    marketCapJpy: 40_000_000_000,
    close: 1200,
    volumeRatio20d: 2.4,
    turnover20dAvgJpy: 300_000_000,
    distanceTo52wHighPct: 0.2,
    baseScore: score,
    score,
    strategy: 'earnings_momentum',
    reasons: ['売上YoY +25%', '営業利益YoY +40%'],
    advancedFilters: null,
    buyAllowed: true,
    requiresFollowThrough: false,
    doNotBuyReasons: [],
    earnings: null,
  };
}

describe('AgentTradingDecision schema', () => {
  it('rejects an empty doNotBuyReasons array', async () => {
    const { agentTradingDecisionSchema } = await import('./schemas.js');
    const base = {
      decision: 'buy' as const,
      symbol: '7203A',
      strategy: 'new_high_breakout' as const,
      budgetJpy: 100000,
      limitPrice: 1000,
      sellPositionPct: null,
      confidence: 0.8,
      expectedHoldingDays: 20,
      stopLossPct: 8,
      reason: 'x',
      thesis: 't',
      riskFactors: [],
      invalidationConditions: [],
    };
    expect(() => agentTradingDecisionSchema.parse({ ...base, doNotBuyReasons: [] })).toThrow();
    expect(agentTradingDecisionSchema.parse({ ...base, doNotBuyReasons: ['地合い悪化'] }).doNotBuyReasons).toHaveLength(1);
  });
});

describe('MockHermesAgentClient', () => {
  it('22a. returns a validated BUY for a high-scoring candidate', async () => {
    const mock = new MockHermesAgentClient();
    const res = await mock.runTradingTask(baseContext({ candidates: [candidate(85)] }));
    const buys = res.decisions.filter((d) => d.decision === 'buy');
    expect(buys).toHaveLength(1);
    expect(buys[0]!.reason).not.toBe('');
    expect(buys[0]!.thesis).not.toBe('');
    expect(buys[0]!.invalidationConditions.length).toBeGreaterThan(0);
    expect(buys[0]!.budgetJpy).toBeGreaterThan(0);
  });

  it('22b. does not buy a low-scoring candidate', async () => {
    const mock = new MockHermesAgentClient();
    const res = await mock.runTradingTask(baseContext({ candidates: [candidate(30)] }));
    expect(res.decisions.filter((d) => d.decision === 'buy')).toHaveLength(0);
  });

  it('22c. returns a SELL when a position hits the stop loss', async () => {
    const mock = new MockHermesAgentClient();
    const res = await mock.runTradingTask(
      baseContext({
        positions: [
          {
            symbol: '4755D',
            name: 'Delta',
            quantity: 100,
            avgPrice: 1000,
            currentPrice: 910,
            unrealizedPnlJpy: -9000,
            unrealizedPnlPct: -9,
            entryReason: 'x',
            strategy: 'new_high_breakout',
            stopLossPrice: 920,
            highestPriceSinceEntry: 1000,
          },
        ],
      }),
    );
    const sells = res.decisions.filter((d) => d.decision === 'sell');
    expect(sells).toHaveLength(1);
    expect(sells[0]!.sellPositionPct).toBe(100);
  });

  it('22d. prepare_watchlist returns watch symbols and no buys', async () => {
    const mock = new MockHermesAgentClient();
    const res = await mock.runTradingTask(
      baseContext({ taskType: 'prepare_watchlist', candidates: [candidate(85)] }),
    );
    expect(res.watchlistSymbols).toContain('6501B');
    expect(res.decisions.filter((d) => d.decision === 'buy')).toHaveLength(0);
  });

  it('reviewBacktest returns a validated proposal with config changes', async () => {
    const mock = new MockHermesAgentClient();
    const proposal = await mock.reviewBacktest({
      strategyVersion: 'kenmo-v1',
      initialCapitalJpy: 1_000_000,
      finalEquityJpy: 900_000,
      totalReturnPct: -10,
      annualizedReturnPct: -8,
      maxDrawdownPct: 25,
      winRatePct: 35,
      profitFactor: 0.9,
      tradeCount: 15,
      avgWinPct: 10,
      avgLossPct: -9,
      averageHoldingDays: 12,
      bestPatterns: [],
      worstPatterns: [],
      recommendationsNeeded: [],
      lossTypeStats: [],
      filterAttribution: [],
    });
    expect(proposal.configChanges.length).toBeGreaterThan(0);
  });
});
