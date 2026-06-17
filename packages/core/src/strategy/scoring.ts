import type {
  DailyBar,
  FinancialResultData,
  StrategyConfig,
  StrategyKind,
} from '../types/index.js';
import {
  distanceTo52wHighPct,
  postEarningsReaction,
  sma25,
  sma75,
  turnover20dAvgJpy,
  volumeRatio20d,
} from './indicators.js';

export interface ScoreBreakdown {
  score: number;
  reasons: string[];
}

const clampScore = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * 決算モメンタム score. Rewards strong YoY sales/operating-profit growth, margin
 * expansion, high progress rate, positive guidance and a strong post-earnings
 * price + volume reaction.
 */
export function earningsMomentumScore(
  bars: DailyBar[],
  fin: FinancialResultData | null,
  config: StrategyConfig,
): ScoreBreakdown {
  const reasons: string[] = [];
  if (!fin) return { score: 0, reasons: ['no recent earnings'] };

  let score = 0;
  if (fin.salesYoyPct >= 10) {
    score += 20;
    reasons.push(`売上YoY +${fin.salesYoyPct.toFixed(1)}%`);
  }
  if (fin.operatingProfitYoyPct >= 20) {
    score += 25;
    reasons.push(`営業利益YoY +${fin.operatingProfitYoyPct.toFixed(1)}%`);
  }
  if (fin.operatingMarginPct > fin.operatingMarginPrevPct) {
    score += 15;
    reasons.push(
      `営業利益率改善 ${fin.operatingMarginPrevPct.toFixed(1)}→${fin.operatingMarginPct.toFixed(1)}%`,
    );
  }
  if (fin.progressRateOpPct >= 50) {
    score += 10;
    reasons.push(`通期進捗率 ${fin.progressRateOpPct.toFixed(0)}%`);
  }
  if (fin.guidanceRevision === 'up') {
    score += 10;
    reasons.push('上方修正');
  } else if (fin.guidanceRevision === 'down') {
    score -= 20;
    reasons.push('下方修正');
  }

  const reaction = postEarningsReaction(bars, fin.announcedAt);
  if (reaction) {
    if (reaction.postEarningsReturnPct > 0) {
      score += 10;
      reasons.push(`決算後 +${reaction.postEarningsReturnPct.toFixed(1)}%`);
    }
    if (reaction.postEarningsVolumeRatio >= config.scoring.minVolumeRatioForEarnings) {
      score += 10;
      reasons.push(`出来高 ${reaction.postEarningsVolumeRatio.toFixed(1)}x`);
    }
  }

  return { score: clampScore(score), reasons };
}

/** 新高値ブレイク score. Close near/above 52w high, above 25/75 MAs, volume surge. */
export function newHighBreakoutScore(
  bars: DailyBar[],
  config: StrategyConfig,
): ScoreBreakdown {
  const reasons: string[] = [];
  const last = bars[bars.length - 1];
  if (!last) return { score: 0, reasons: ['no price data'] };

  let score = 0;
  const dist = distanceTo52wHighPct(bars);
  if (dist !== null) {
    if (dist <= 0.5) {
      score += 35;
      reasons.push('52週高値更新');
    } else if (dist <= 5) {
      score += 20;
      reasons.push(`52週高値まで ${dist.toFixed(1)}%`);
    }
  }
  const ma25 = sma25(bars);
  const ma75 = sma75(bars);
  if (ma25 !== null && last.close > ma25) {
    score += 15;
    reasons.push('25日線より上');
  }
  if (ma75 !== null && last.close > ma75) {
    score += 15;
    reasons.push('75日線より上');
  }
  const vr = volumeRatio20d(bars);
  if (vr !== null && vr >= config.scoring.minVolumeRatioForBreakout) {
    score += 20;
    reasons.push(`出来高 ${vr.toFixed(1)}x`);
  }
  // Avoid chasing a limit-up (ストップ高張り付き): open == high == close near high.
  if (last.open === last.high && last.high === last.close) {
    score -= 15;
    reasons.push('ストップ高張り付き懸念');
  }
  return { score: clampScore(score), reasons };
}

/** 成長性・ROE・利益率改善 score. */
export function roeGrowthScore(
  bars: DailyBar[],
  fin: FinancialResultData | null,
): ScoreBreakdown {
  const reasons: string[] = [];
  if (!fin) return { score: 0, reasons: ['no financials'] };

  let score = 0;
  if (fin.roePct >= 10) {
    score += 30;
    reasons.push(`ROE ${fin.roePct.toFixed(1)}%`);
  }
  if (fin.operatingMarginPct > fin.operatingMarginPrevPct) {
    score += 20;
    reasons.push('営業利益率改善');
  }
  if (fin.salesYoyPct >= 10) {
    score += 25;
    reasons.push('売上成長継続');
  }
  if (fin.operatingProfitYoyPct >= 10) {
    score += 25;
    reasons.push('利益成長継続');
  }
  return { score: clampScore(score), reasons };
}

export interface SymbolScores {
  earningsMomentum: ScoreBreakdown;
  newHighBreakout: ScoreBreakdown;
  roeGrowth: ScoreBreakdown;
  bestStrategy: StrategyKind;
  bestScore: number;
}

export function scoreSymbol(
  bars: DailyBar[],
  fin: FinancialResultData | null,
  config: StrategyConfig,
): SymbolScores {
  const earningsMomentum = earningsMomentumScore(bars, fin, config);
  const newHighBreakout = newHighBreakoutScore(bars, config);
  const roeGrowth = roeGrowthScore(bars, fin);

  const ranked: Array<{ kind: StrategyKind; score: number }> = [
    { kind: 'earnings_momentum' as StrategyKind, score: earningsMomentum.score },
    { kind: 'new_high_breakout' as StrategyKind, score: newHighBreakout.score },
    { kind: 'roe_growth' as StrategyKind, score: roeGrowth.score },
  ];
  ranked.sort((a, b) => b.score - a.score);

  const top = ranked[0]!;
  return {
    earningsMomentum,
    newHighBreakout,
    roeGrowth,
    bestStrategy: top.kind,
    bestScore: top.score,
  };
}
