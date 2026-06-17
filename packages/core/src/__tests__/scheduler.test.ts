import { describe, it, expect } from 'vitest';
import { generateScheduleForDates, VIRTUAL_DAY_SCHEDULE } from '../scheduler/schedule.js';
import { SeedMarketDataProvider } from '../market/MarketDataProvider.js';
import { buildSampleDataset } from '../fixtures/sampleDataset.js';

describe('virtual scheduler', () => {
  it('19. creates events in chronological order across days', () => {
    const plan = generateScheduleForDates(['2022-06-01', '2022-06-02']);
    expect(plan).toHaveLength(VIRTUAL_DAY_SCHEDULE.length * 2);
    for (let i = 1; i < plan.length; i++) {
      const prev = plan[i - 1]!;
      const cur = plan[i]!;
      const prevKey = `${prev.eventDate} ${prev.virtualTime}`;
      const curKey = `${cur.eventDate} ${cur.virtualTime}`;
      expect(curKey >= prevKey).toBe(true);
      expect(cur.sequence).toBe(prev.sequence + 1);
    }
  });

  it('20. includes prepare_watchlist -> monitor_and_trade -> after_close_analysis in a day', () => {
    const types = VIRTUAL_DAY_SCHEDULE.map((e) => e.eventType);
    expect(types[0]).toBe('prepare_watchlist');
    expect(types).toContain('monitor_and_trade');
    expect(types[types.length - 1]).toBe('after_close_analysis');
  });
});

describe('market data provider future-leakage guard', () => {
  it('21. getFinancialResults(until) excludes future-dated results', async () => {
    const provider = new SeedMarketDataProvider(buildSampleDataset());
    const asOf = '2022-06-01';
    const fins = await provider.getFinancialResults('6501B', asOf);
    expect(fins.every((f) => f.announcedAt <= asOf)).toBe(true);

    const allFins = await provider.getFinancialResults('6501B', '2099-01-01');
    expect(allFins.length).toBeGreaterThan(fins.length);
  });

  it('getLatestPrice never returns a future bar', async () => {
    const provider = new SeedMarketDataProvider(buildSampleDataset());
    const asOf = '2022-06-01';
    const bar = await provider.getLatestPrice('7203A', asOf);
    expect(bar).not.toBeNull();
    expect(bar!.date <= asOf).toBe(true);
  });
});
