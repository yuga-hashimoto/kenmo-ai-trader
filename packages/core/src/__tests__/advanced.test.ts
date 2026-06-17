import { describe, it, expect } from 'vitest';
import {
  isLimitDownLocked,
  isLimitUpLocked,
  limitDownPrice,
  limitUpPrice,
  priceLimitWidth,
} from '../market/priceLimits.js';
import { participationCap } from '../backtest/fill.js';
import {
  RealtimeMarketScheduler,
  isTradingDay,
  sessionPlan,
} from '../scheduler/RealtimeMarketScheduler.js';
import { LiveBrokerAdapter, LiveTradingDisabledError } from '../broker/LiveBrokerAdapter.js';
import { DEFAULT_STRATEGY_CONFIG } from '../config/defaults.js';

describe('price limits (ストップ高安)', () => {
  it('uses the JPY price-limit table', () => {
    expect(priceLimitWidth(900)).toBe(150); // 700–1000 band
    expect(priceLimitWidth(1200)).toBe(300); // 1000–1500 band
    expect(limitUpPrice(900)).toBe(1050);
    expect(limitDownPrice(900)).toBe(750);
  });

  it('detects limit-up lock (張り付き → cannot buy)', () => {
    // prevClose 900 -> up 1050. A bar locked at the ceiling: low==high==1050
    expect(isLimitUpLocked({ low: 1050, high: 1050 }, 900)).toBe(true);
    expect(isLimitUpLocked({ low: 1000, high: 1050 }, 900)).toBe(false);
  });

  it('detects limit-down lock (張り付き → cannot sell)', () => {
    expect(isLimitDownLocked({ low: 750, high: 750 }, 900)).toBe(true);
    expect(isLimitDownLocked({ low: 750, high: 800 }, 900)).toBe(false);
  });
});

describe('participation cap (板/流動性)', () => {
  it('caps quantity to a fraction of the day volume', () => {
    expect(participationCap(1000, 5000, 0.1)).toBe(500);
    expect(participationCap(100, 5000, 0.1)).toBe(100);
    expect(participationCap(1000, 0, 0.1)).toBe(0);
  });
});

describe('RealtimeMarketScheduler', () => {
  const config = DEFAULT_STRATEGY_CONFIG.scheduler;

  it('builds an 8-event session plan', () => {
    expect(sessionPlan(config)).toHaveLength(8);
    expect(sessionPlan(config)[0]).toEqual({ time: '08:30', eventType: 'prepare_watchlist' });
  });

  it('skips weekends and holidays', () => {
    expect(isTradingDay('2022-06-06')).toBe(true); // Monday
    expect(isTradingDay('2022-06-04')).toBe(false); // Saturday
    expect(isTradingDay('2022-06-06', new Set(['2022-06-06']))).toBe(false);
  });

  it('computes the next event from a given clock time', () => {
    // Monday 2022-06-06 09:30 JST -> next is 10:30 monitor_and_trade
    const sched = new RealtimeMarketScheduler(config, () => {}, {
      now: () => new Date('2022-06-06T00:30:00Z'), // 09:30 JST
    });
    const next = sched.nextEvent();
    expect(next?.time).toBe('10:30');
    expect(next?.eventType).toBe('monitor_and_trade');
  });

  it('rolls to the next trading day after the close', () => {
    const sched = new RealtimeMarketScheduler(config, () => {}, {
      now: () => new Date('2022-06-10T09:00:00Z'), // Fri 18:00 JST (after close)
    });
    const next = sched.nextEvent();
    expect(next?.date).toBe('2022-06-13'); // Monday
    expect(next?.eventType).toBe('prepare_watchlist');
  });
});

describe('LiveBrokerAdapter safety gate', () => {
  const req = {
    runType: 'live' as const,
    runId: 'r',
    symbolCode: '7203A',
    side: 'buy' as const,
    orderType: 'limit' as const,
    requestedQuantity: 100,
    limitPrice: 1000,
    reason: 'x',
    strategy: 'new_high_breakout',
    confidence: 0.9,
    atDate: '2022-06-06',
  };

  it('is inert by default (all gates closed)', async () => {
    const live = new LiveBrokerAdapter({ enableLiveTrading: false, liveConfirmed: false });
    expect(live.isArmed).toBe(false);
    await expect(live.placeOrder(req)).rejects.toBeInstanceOf(LiveTradingDisabledError);
  });

  it('still refuses with the disabled stub even when gates are open', async () => {
    const live = new LiveBrokerAdapter({ enableLiveTrading: true, liveConfirmed: true });
    expect(live.isArmed).toBe(true);
    await expect(live.placeOrder(req)).rejects.toThrow(/stub only/);
  });
});
