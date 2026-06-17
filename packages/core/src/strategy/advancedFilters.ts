import type {
  AdvancedFiltersConfig,
  DailyBar,
  FinancialResultData,
  MarketRegimeLabel,
} from '../types/index.js';
import { sma25, sma75, volumeRatio20d } from './indicators.js';

/* ------------------------------- features -------------------------------- */

export interface EarningsQualityFeature {
  score: number;
  salesGrowthScore: number;
  operatingProfitGrowthScore: number;
  operatingMarginImprovementScore: number;
  oneTimeProfitRiskPenalty: number;
  noSalesGrowthPenalty: number;
  operatingMarginDeteriorationPenalty: number;
  guidanceRevisionScore: number;
  positiveFactors: string[];
  negativeFactors: string[];
  oneTimeProfitRisk: 'low' | 'medium' | 'high';
}

export interface GapOverheatFeature {
  postEarningsGapPct: number;
  penalty: number;
  requiresFollowThrough: boolean;
  noBuyReason: string | null;
}

export interface FollowThroughFeature {
  passed: boolean;
  daysAfterEarnings: number;
  aboveEarningsDayLow: boolean;
  volumeRatio20d: number;
  aboveMa25: boolean;
  reason: string;
}

export interface MarketRegimeFeature {
  indexCode: string;
  close: number;
  ma25: number;
  ma75: number;
  regime: MarketRegimeLabel;
  positionSizeMultiplier: number;
  allowNewBuy: boolean;
}

export interface RelativeStrengthFeature {
  stockReturn20d: number;
  marketReturn20d: number;
  relativeReturn20d: number;
  stockReturn60d: number;
  marketReturn60d: number;
  relativeReturn60d: number;
  score: number;
}

export interface AdvancedFiltersResult {
  earningsQuality: EarningsQualityFeature | null;
  gapOverheat: GapOverheatFeature | null;
  followThrough: FollowThroughFeature | null;
  marketRegime: MarketRegimeFeature | null;
  relativeStrength: RelativeStrengthFeature | null;
  buyAllowed: boolean;
  requiresFollowThrough: boolean;
  doNotBuyReasons: string[];
  scoreAdjustment: number;
}

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

const ONE_TIME_KEYWORDS = [
  '特別利益',
  '為替差益',
  '為替益',
  '補助金',
  '助成金',
  '売却益',
  '固定資産売却',
  '投資有価証券売却',
  '一過性',
  '持分変動利益',
];

/* --------------------------- EarningsQuality ----------------------------- */

export function computeEarningsQuality(
  fin: FinancialResultData | null,
  disclosureText: string,
  config: AdvancedFiltersConfig['earningsQuality'],
): EarningsQualityFeature | null {
  if (!fin) return null;
  const positiveFactors: string[] = [];
  const negativeFactors: string[] = [];

  let salesGrowthScore = 0;
  if (fin.salesYoyPct >= 10) {
    salesGrowthScore = 25;
    positiveFactors.push(`売上YoY +${fin.salesYoyPct.toFixed(1)}%`);
  }

  let operatingProfitGrowthScore = 0;
  if (fin.operatingProfitYoyPct >= 20) {
    operatingProfitGrowthScore = 25;
    positiveFactors.push(`営業利益YoY +${fin.operatingProfitYoyPct.toFixed(1)}%`);
  }

  let operatingMarginImprovementScore = 0;
  if (fin.operatingMarginPct > fin.operatingMarginPrevPct) {
    operatingMarginImprovementScore = 20;
    positiveFactors.push('営業利益率改善');
  }

  let guidanceRevisionScore = 0;
  if (fin.guidanceRevision === 'up') {
    guidanceRevisionScore = 20;
    positiveFactors.push('上方修正');
  } else if (fin.guidanceRevision === 'down') {
    guidanceRevisionScore = -40;
    negativeFactors.push('下方修正');
  }

  // penalties
  let noSalesGrowthPenalty = 0;
  if (config.penalizeNoSalesGrowth && fin.salesYoyPct < 3 && fin.operatingProfitYoyPct >= 15) {
    noSalesGrowthPenalty = -30;
    negativeFactors.push('売上成長なしで利益だけ増加');
  }

  let operatingMarginDeteriorationPenalty = 0;
  if (config.penalizeOperatingMarginDeterioration && fin.operatingMarginPct < fin.operatingMarginPrevPct) {
    operatingMarginDeteriorationPenalty = -15;
    negativeFactors.push('営業利益率悪化');
  }

  let oneTimeProfitRiskPenalty = 0;
  let oneTimeProfitRisk: 'low' | 'medium' | 'high' = 'low';
  if (config.penalizeOneTimeProfit) {
    const hits = ONE_TIME_KEYWORDS.filter((k) => disclosureText.includes(k));
    // big net-income jump without operating-profit growth also smells one-time
    const netVsOp = fin.operatingProfitYoyPct < 10 && fin.netIncome > fin.operatingProfit * 1.3;
    if (hits.length >= 2 || (hits.length >= 1 && netVsOp)) {
      oneTimeProfitRiskPenalty = -30;
      oneTimeProfitRisk = 'high';
      negativeFactors.push(`一過性利益の疑い(${hits.slice(0, 2).join('/')})`);
    } else if (hits.length === 1 || netVsOp) {
      oneTimeProfitRiskPenalty = -15;
      oneTimeProfitRisk = 'medium';
      negativeFactors.push('一過性利益の可能性');
    }
  }

  const score = clamp(
    salesGrowthScore +
      operatingProfitGrowthScore +
      operatingMarginImprovementScore +
      guidanceRevisionScore +
      noSalesGrowthPenalty +
      operatingMarginDeteriorationPenalty +
      oneTimeProfitRiskPenalty,
  );

  return {
    score,
    salesGrowthScore,
    operatingProfitGrowthScore,
    operatingMarginImprovementScore,
    oneTimeProfitRiskPenalty,
    noSalesGrowthPenalty,
    operatingMarginDeteriorationPenalty,
    guidanceRevisionScore,
    positiveFactors,
    negativeFactors,
    oneTimeProfitRisk,
  };
}

/* ----------------------------- GapOverheat ------------------------------- */

export function computeGapOverheat(
  bars: DailyBar[],
  fin: FinancialResultData | null,
  config: AdvancedFiltersConfig['gapOverheat'],
): GapOverheatFeature | null {
  if (!fin) return null;
  const idx = bars.findIndex((b) => b.date >= fin.announcedAt);
  if (idx <= 0) return null;
  const prev = bars[idx - 1]!;
  const earningsDay = bars[idx]!;
  if (prev.close <= 0) return null;
  const postEarningsGapPct = ((earningsDay.open - prev.close) / prev.close) * 100;

  let penalty = 0;
  let requiresFollowThrough = false;
  let noBuyReason: string | null = null;

  if (postEarningsGapPct >= config.gapNoBuyPct) {
    penalty = -60;
    noBuyReason = `決算ギャップ +${postEarningsGapPct.toFixed(1)}% (>=${config.gapNoBuyPct}%) で原則買い禁止`;
  } else if (postEarningsGapPct >= config.gapStrongPenaltyPct) {
    penalty = -30;
    requiresFollowThrough = true;
  } else if (postEarningsGapPct >= config.gapWaitThresholdPct) {
    penalty = -15;
    requiresFollowThrough = true;
  } else if (postEarningsGapPct >= config.gapSoftPenaltyPct) {
    penalty = -8;
  }

  // ストップ高張り付き相当（始値=高値=安値=終値かつ大幅高）
  if (
    config.noBuyStopHigh &&
    earningsDay.open === earningsDay.high &&
    earningsDay.high === earningsDay.low &&
    postEarningsGapPct >= config.gapSoftPenaltyPct
  ) {
    noBuyReason = 'ストップ高張り付き相当で買い不可';
  }

  return { postEarningsGapPct, penalty, requiresFollowThrough, noBuyReason };
}

/* ---------------------------- FollowThrough ------------------------------ */

export function computeFollowThrough(
  bars: DailyBar[],
  fin: FinancialResultData | null,
  config: AdvancedFiltersConfig['followThrough'],
): FollowThroughFeature | null {
  if (!fin) return null;
  const idx = bars.findIndex((b) => b.date >= fin.announcedAt);
  if (idx < 0) return null;
  const earningsDay = bars[idx]!;
  const prevClose = idx > 0 ? bars[idx - 1]!.close : earningsDay.open;
  const last = bars[bars.length - 1]!;
  const daysAfterEarnings = bars.length - 1 - idx;

  const aboveEarningsDayLow = last.close >= earningsDay.low;
  const vr = volumeRatio20d(bars) ?? 0;
  const ma25 = sma25(bars);
  const aboveMa25 = ma25 !== null && last.close > ma25;
  const abovePreEarningsClose = last.close > prevClose;

  const inWindow =
    daysAfterEarnings >= config.minDaysAfterEarnings &&
    daysAfterEarnings <= config.maxDaysAfterEarnings;

  const reasons: string[] = [];
  if (!inWindow) reasons.push(`決算後${daysAfterEarnings}日(窓外)`);
  if (config.requireAboveEarningsDayLow && !aboveEarningsDayLow) reasons.push('決算翌日安値割れ');
  if (vr < config.minVolumeRatio20d) reasons.push(`出来高${vr.toFixed(1)}x<${config.minVolumeRatio20d}x`);
  if (config.requireAboveMa25 && !aboveMa25) reasons.push('25日線割れ');
  if (!abovePreEarningsClose) reasons.push('決算前終値割れ');

  const passed = inWindow && reasons.length === 0;
  return {
    passed,
    daysAfterEarnings,
    aboveEarningsDayLow,
    volumeRatio20d: vr,
    aboveMa25,
    reason: passed ? 'follow-through 確認' : reasons.join(', '),
  };
}

/* ---------------------------- MarketRegime ------------------------------- */

export function computeMarketRegime(
  indexBars: DailyBar[],
  config: AdvancedFiltersConfig['marketRegime'],
  indexCode: string,
): MarketRegimeFeature | null {
  const last = indexBars[indexBars.length - 1];
  if (!last) return null;
  const ma25 = sma25(indexBars) ?? last.close;
  const ma75 = sma75(indexBars) ?? last.close;

  let regime: MarketRegimeLabel = 'risk_on';
  let positionSizeMultiplier = 1;
  let allowNewBuy = true;

  if (last.close < ma75) {
    regime = 'risk_off';
    positionSizeMultiplier = 0;
    if (config.stopNewBuyBelowMa75) allowNewBuy = false;
  } else if (last.close < ma25) {
    regime = 'neutral';
    positionSizeMultiplier = config.reduceExposureBelowMa25
      ? config.badRegimePositionSizeMultiplier
      : 1;
  }

  return {
    indexCode,
    close: last.close,
    ma25,
    ma75,
    regime,
    positionSizeMultiplier,
    allowNewBuy,
  };
}

/* --------------------------- RelativeStrength ---------------------------- */

function returnPct(bars: DailyBar[], lookback: number): number | null {
  if (bars.length <= lookback) return null;
  const now = bars[bars.length - 1]!.close;
  const past = bars[bars.length - 1 - lookback]!.close;
  if (past <= 0) return null;
  return ((now - past) / past) * 100;
}

export function computeRelativeStrength(
  stockBars: DailyBar[],
  indexBars: DailyBar[],
  config: AdvancedFiltersConfig['relativeStrength'],
): RelativeStrengthFeature | null {
  const sShort = returnPct(stockBars, config.lookbackDaysShort);
  const sLong = returnPct(stockBars, config.lookbackDaysLong);
  const mShort = returnPct(indexBars, config.lookbackDaysShort) ?? 0;
  const mLong = returnPct(indexBars, config.lookbackDaysLong) ?? 0;
  if (sShort === null || sLong === null) return null;

  const rShort = sShort - mShort;
  const rLong = sLong - mLong;

  let score = 50;
  if (rShort > 0) score += 20;
  if (rLong > 0) score += 20;
  if (rShort < 0 && rLong < 0) score -= 40;
  score = clamp(score);

  return {
    stockReturn20d: sShort,
    marketReturn20d: mShort,
    relativeReturn20d: rShort,
    stockReturn60d: sLong,
    marketReturn60d: mLong,
    relativeReturn60d: rLong,
    score,
  };
}

/* ----------------------------- orchestrator ------------------------------ */

export interface AdvancedFiltersInput {
  bars: DailyBar[];
  latestFinancial: FinancialResultData | null;
  disclosureText: string;
  indexBars: DailyBar[];
  marketRegime: MarketRegimeFeature | null;
}

/**
 * Apply all enabled advanced filters to one candidate, producing the persisted
 * feature blocks plus a buy gate, follow-through requirement, doNotBuyReasons and
 * a score adjustment. Every block respects its `enabled` flag (for ablation).
 */
export function applyAdvancedFilters(
  input: AdvancedFiltersInput,
  config: AdvancedFiltersConfig,
): AdvancedFiltersResult {
  const doNotBuyReasons: string[] = [];
  let buyAllowed = true;
  let requiresFollowThrough = false;
  let scoreAdjustment = 0;

  const earningsQuality = config.earningsQuality.enabled
    ? computeEarningsQuality(input.latestFinancial, input.disclosureText, config.earningsQuality)
    : null;
  if (earningsQuality) {
    scoreAdjustment += ((earningsQuality.score - 50) / 50) * config.earningsQuality.weight;
    if (earningsQuality.score < config.earningsQuality.minScoreToBuy) {
      buyAllowed = false;
      doNotBuyReasons.push(
        `決算品質スコア${earningsQuality.score} < ${config.earningsQuality.minScoreToBuy}`,
      );
    }
    if (earningsQuality.oneTimeProfitRisk === 'high') {
      buyAllowed = false;
      doNotBuyReasons.push('一過性利益リスクが高い');
    }
    for (const n of earningsQuality.negativeFactors) doNotBuyReasons.push(n);
  }

  const gapOverheat = config.gapOverheat.enabled
    ? computeGapOverheat(input.bars, input.latestFinancial, config.gapOverheat)
    : null;
  if (gapOverheat) {
    scoreAdjustment += gapOverheat.penalty;
    if (gapOverheat.noBuyReason) {
      buyAllowed = false;
      doNotBuyReasons.push(gapOverheat.noBuyReason);
    }
    if (gapOverheat.requiresFollowThrough) requiresFollowThrough = true;
  }

  const followThrough = config.followThrough.enabled
    ? computeFollowThrough(input.bars, input.latestFinancial, config.followThrough)
    : null;
  if (requiresFollowThrough) {
    const highQuality =
      config.followThrough.allowImmediateBuyIfHighQualityAndNotOverheated &&
      earningsQuality !== null &&
      earningsQuality.score >= 75 &&
      (gapOverheat?.postEarningsGapPct ?? 0) < config.gapOverheat.gapSoftPenaltyPct;
    if (!highQuality && (!followThrough || !followThrough.passed)) {
      buyAllowed = false;
      doNotBuyReasons.push(`follow-through 未確認: ${followThrough?.reason ?? 'データ不足'}`);
    }
  }

  const marketRegime = config.marketRegime.enabled ? input.marketRegime : null;
  if (marketRegime && !marketRegime.allowNewBuy) {
    buyAllowed = false;
    doNotBuyReasons.push(`地合い ${marketRegime.regime} で新規買い停止`);
  }

  const relativeStrength = config.relativeStrength.enabled
    ? computeRelativeStrength(input.bars, input.indexBars, config.relativeStrength)
    : null;
  if (relativeStrength) {
    scoreAdjustment += (relativeStrength.score - 50) / 5;
    if (relativeStrength.relativeReturn20d < 0 && relativeStrength.relativeReturn60d < 0) {
      doNotBuyReasons.push('市場比で相対的に弱い');
    }
  }

  return {
    earningsQuality,
    gapOverheat,
    followThrough,
    marketRegime,
    relativeStrength,
    buyAllowed,
    requiresFollowThrough,
    doNotBuyReasons,
    scoreAdjustment,
  };
}
