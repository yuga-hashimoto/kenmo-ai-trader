import { describe, it, expect } from 'vitest';
import {
  applyAdvancedFilters,
  computeEarningsQuality,
  computeFollowThrough,
  computeGapOverheat,
  computeMarketRegime,
  computeRelativeStrength,
} from '../strategy/advancedFilters.js';
import { classifyOutcome } from '../strategy/lossType.js';
import { proposeFromLossStats } from '../evolution/evolution.js';
import { generateAblationVariants } from '../evolution/ablation.js';
import { DEFAULT_STRATEGY_CONFIG } from '../config/defaults.js';
import type { DailyBar, FinancialResultData } from '../types/index.js';

const af = DEFAULT_STRATEGY_CONFIG.advancedFilters;

function fin(overrides: Partial<FinancialResultData> = {}): FinancialResultData {
  return {
    symbolCode: 'X',
    announcedAt: '2022-06-10',
    fiscalPeriod: 'FY-Q1',
    sales: 1e10,
    operatingProfit: 1e9,
    ordinaryProfit: 1e9,
    netIncome: 8e8,
    salesYoyPct: 20,
    operatingProfitYoyPct: 30,
    operatingMarginPct: 12,
    operatingMarginPrevPct: 10,
    roePct: 14,
    progressRateOpPct: 55,
    guidanceRevision: 'none',
    ...overrides,
  };
}

function bars(closes: number[], startDate = '2022-05-01'): DailyBar[] {
  const d = new Date(`${startDate}T00:00:00Z`);
  return closes.map((c, i) => {
    const date = new Date(d.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { symbolCode: 'X', date, open: c, high: c + 2, low: c - 2, close: c, volume: 200000, turnoverValue: c * 200000 };
  });
}

describe('EarningsQualityScore', () => {
  it('一過性利益キーワードがあるとスコアが下がる', () => {
    const clean = computeEarningsQuality(fin(), '通常の決算', af.earningsQuality);
    const dirty = computeEarningsQuality(
      fin(),
      '固定資産売却益と為替差益により特別利益を計上',
      af.earningsQuality,
    );
    expect(dirty!.score).toBeLessThan(clean!.score);
    expect(dirty!.oneTimeProfitRisk).not.toBe('low');
  });

  it('売上成長なしで利益だけ増は減点される', () => {
    const noGrowth = computeEarningsQuality(
      fin({ salesYoyPct: 1, operatingProfitYoyPct: 25 }),
      '',
      af.earningsQuality,
    );
    expect(noGrowth!.noSalesGrowthPenalty).toBeLessThan(0);
  });
});

describe('GapOverheatPenalty', () => {
  it('gap>=12% で requiresFollowThrough になる', () => {
    // prevClose 1000, earnings-day open 1130 -> +13%
    const b = bars([1000, 1130, 1140], '2022-06-09'); // announce on 2nd bar (2022-06-10)
    const g = computeGapOverheat(b, fin({ announcedAt: '2022-06-10' }), af.gapOverheat);
    expect(g!.postEarningsGapPct).toBeGreaterThanOrEqual(12);
    expect(g!.requiresFollowThrough).toBe(true);
  });

  it('gap>=20% で原則買い禁止 (noBuyReason)', () => {
    const b = bars([1000, 1210, 1220], '2022-06-09');
    const g = computeGapOverheat(b, fin({ announcedAt: '2022-06-10' }), af.gapOverheat);
    expect(g!.postEarningsGapPct).toBeGreaterThanOrEqual(20);
    expect(g!.noBuyReason).not.toBeNull();
  });
});

describe('FollowThroughFilter', () => {
  it('条件を満たすと passed=true で買い候補に戻る', () => {
    // earnings day low ~ index, then rising closes above 25ma & pre-earnings close, high volume
    const closes = Array.from({ length: 30 }, (_, i) => 1000 + i * 5); // steady uptrend
    const b = bars(closes, '2022-05-10');
    // mark earnings ~3 bars before the end
    const announceDate = b[b.length - 4]!.date;
    const ft = computeFollowThrough(b, fin({ announcedAt: announceDate }), af.followThrough);
    expect(ft!.daysAfterEarnings).toBeGreaterThanOrEqual(af.followThrough.minDaysAfterEarnings);
    expect(ft!.aboveMa25).toBe(true);
  });
});

describe('MarketRegimeFilter', () => {
  it('指数が75日線下なら新規買い停止', () => {
    // 80 up bars then a sharp drop below the 75d MA
    const up = Array.from({ length: 80 }, (_, i) => 1000 + i * 5);
    const down = Array.from({ length: 5 }, () => 1000); // well below recent MA
    const idx = bars([...up, ...down], '2022-01-03');
    const mr = computeMarketRegime(idx, af.marketRegime, 'GROWTH_MOCK');
    expect(mr!.regime).toBe('risk_off');
    expect(mr!.allowNewBuy).toBe(false);
  });

  it('applyAdvancedFilters blocks buys in risk_off', () => {
    const up = Array.from({ length: 80 }, (_, i) => 1000 + i * 5);
    const down = Array.from({ length: 5 }, () => 1000);
    const idx = bars([...up, ...down], '2022-01-03');
    const mr = computeMarketRegime(idx, af.marketRegime, 'GROWTH_MOCK');
    const res = applyAdvancedFilters(
      { bars: bars([1000, 1010, 1020]), latestFinancial: fin(), disclosureText: '', indexBars: idx, marketRegime: mr },
      af,
    );
    expect(res.buyAllowed).toBe(false);
    expect(res.doNotBuyReasons.some((r) => r.includes('risk_off'))).toBe(true);
  });
});

describe('RelativeStrengthScore', () => {
  it('市場より弱いと減点', () => {
    const stock = bars(Array.from({ length: 70 }, (_, i) => 1000 - i)); // falling
    const index = bars(Array.from({ length: 70 }, (_, i) => 1000 + i)); // rising
    const rs = computeRelativeStrength(stock, index, af.relativeStrength);
    expect(rs!.relativeReturn20d).toBeLessThan(0);
    expect(rs!.score).toBeLessThan(50);
  });
});

describe('LossTypeClassification', () => {
  const base = { exitReason: 'stop_loss -8%', features: {} };
  it('winは lossType=null', () => {
    expect(classifyOutcome({ pnlJpy: 100, ...base }).lossType).toBeNull();
  });
  it('chased_gap_up', () => {
    expect(
      classifyOutcome({ pnlJpy: -100, exitReason: 'x', features: { gapOverheat: { postEarningsGapPct: 14, penalty: -30, requiresFollowThrough: true, noBuyReason: null } } }).lossType,
    ).toBe('chased_gap_up');
  });
  it('weak_earnings_quality', () => {
    expect(
      classifyOutcome({ pnlJpy: -100, exitReason: 'x', features: { earningsQuality: { score: 40 } as never } }).lossType,
    ).toBe('weak_earnings_quality');
  });
  it('market_regime_bad', () => {
    expect(
      classifyOutcome({ pnlJpy: -100, exitReason: 'x', features: { marketRegime: { regime: 'risk_off' } as never } }).lossType,
    ).toBe('market_regime_bad');
  });
  it('no_follow_through', () => {
    expect(
      classifyOutcome({ pnlJpy: -100, exitReason: 'x', features: { followThrough: { passed: false } as never } }).lossType,
    ).toBe('no_follow_through');
  });
  it('low_relative_strength', () => {
    expect(
      classifyOutcome({ pnlJpy: -100, exitReason: 'x', features: { relativeStrength: { score: 20 } as never } }).lossType,
    ).toBe('low_relative_strength');
  });
  it('stop_loss_normal', () => {
    expect(classifyOutcome({ pnlJpy: -100, exitReason: 'stop_loss -8%', features: {} }).lossType).toBe('stop_loss_normal');
  });
});

describe('Evolution from loss stats', () => {
  it('chased_gap_up が多いとギャップ閾値を下げる提案を出す', () => {
    const changes = proposeFromLossStats(
      [{ lossType: 'chased_gap_up', tradeCount: 5, totalLossJpy: -50000, avgReturnPct: -10, examples: [] }],
      DEFAULT_STRATEGY_CONFIG,
    );
    expect(changes.some((c) => c.path === 'advancedFilters.gapOverheat.gapWaitThresholdPct')).toBe(true);
  });
});

describe('Ablation variants', () => {
  it('generates 8 named variants with the right enabled flags', () => {
    const variants = generateAblationVariants(DEFAULT_STRATEGY_CONFIG);
    expect(variants).toHaveLength(8);
    const eqOnly = variants.find((v) => v.name === 'earnings-quality-only')!;
    expect(eqOnly.config.advancedFilters.earningsQuality.enabled).toBe(true);
    expect(eqOnly.config.advancedFilters.marketRegime.enabled).toBe(false);
    const all = variants.find((v) => v.name === 'all-selected-advanced-filters')!;
    expect(all.config.advancedFilters.relativeStrength.enabled).toBe(true);
  });
});
