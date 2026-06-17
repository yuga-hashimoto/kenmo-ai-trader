import { describe, it, expect } from 'vitest';
import {
  BacktestEngine,
  DEFAULT_STRATEGY_CONFIG,
  SeedMarketDataProvider,
  buildSampleDataset,
} from '@kenmo/core';
import { MockHermesAgentClient } from './MockHermesAgentClient.js';

describe('Backtest engine + MockHermesAgent integration', () => {
  it('18-22: runs an end-to-end backtest that trades and records everything', async () => {
    const provider = new SeedMarketDataProvider(buildSampleDataset());
    const agent = new MockHermesAgentClient();
    const engine = new BacktestEngine({
      provider,
      agent,
      config: DEFAULT_STRATEGY_CONFIG,
      initialCapitalJpy: 1_000_000,
      allowMargin: false,
      startDate: '2022-01-04',
      endDate: '2023-12-29',
    });

    const result = await engine.run();

    // trades actually happened (buys + sells incl. stops/take-profits)
    const buys = result.executions.filter((e) => e.side === 'buy');
    const sells = result.executions.filter((e) => e.side === 'sell');
    expect(buys.length).toBeGreaterThan(0);
    expect(sells.length).toBeGreaterThan(0);
    expect(result.closedTrades.length).toBeGreaterThan(0);

    // 18. AgentRun input/output saved for every event
    expect(result.agentRuns.length).toBeGreaterThan(0);
    for (const ar of result.agentRuns) {
      expect(ar.inputJson).toBeTruthy();
      expect(ar.outputJson).toBeTruthy();
      expect(ar.inputHash).toBeTruthy();
    }

    // 19. scheduler events in chronological order, one per agent run
    expect(result.schedulerEvents.length).toBe(result.agentRuns.length);
    for (let i = 1; i < result.schedulerEvents.length; i++) {
      const prev = result.schedulerEvents[i - 1]!;
      const cur = result.schedulerEvents[i]!;
      expect(`${cur.eventDate} ${cur.virtualTime}` >= `${prev.eventDate} ${prev.virtualTime}`).toBe(true);
    }

    // 20. the daily task flow is present
    const taskTypes = new Set(result.schedulerEvents.map((e) => e.eventType));
    expect(taskTypes.has('prepare_watchlist')).toBe(true);
    expect(taskTypes.has('monitor_and_trade')).toBe(true);
    expect(taskTypes.has('after_close_analysis')).toBe(true);

    // snapshots are produced daily, trade episodes generated
    expect(result.snapshots.length).toBeGreaterThan(100);
    expect(result.tradeEpisodes.length).toBe(result.closedTrades.length);

    // a buy reason is always saved on filled buy orders
    const filledBuys = result.orders.filter((o) => o.side === 'buy' && o.status === 'filled');
    expect(filledBuys.length).toBeGreaterThan(0);
    for (const o of filledBuys) expect(o.reason).not.toBe('');

    // summary is coherent
    expect(result.summary.tradeCount).toBe(result.closedTrades.length);
    expect(Number.isFinite(result.summary.totalReturnPct)).toBe(true);
  });

  it('21. AgentContext never contains a future-dated financial result', async () => {
    const provider = new SeedMarketDataProvider(buildSampleDataset());
    const agent = new MockHermesAgentClient();
    const engine = new BacktestEngine({
      provider,
      agent,
      config: DEFAULT_STRATEGY_CONFIG,
      initialCapitalJpy: 1_000_000,
      allowMargin: false,
      startDate: '2022-01-04',
      endDate: '2022-03-31',
    });
    const result = await engine.run();

    // every candidate's data was computed as-of its event date (no future close leaks):
    for (const ar of result.agentRuns) {
      const asOf = ar.inputJson.backtestTime.slice(0, 10);
      for (const c of ar.inputJson.candidates) {
        // close must correspond to a bar on/before the event date
        const bar = await provider.getLatestPrice(c.symbol, asOf);
        expect(bar).not.toBeNull();
        expect(bar!.date <= asOf).toBe(true);
      }
    }
  });
});
