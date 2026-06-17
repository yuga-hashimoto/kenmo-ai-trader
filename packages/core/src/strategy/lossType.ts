import type { LossType } from '../types/index.js';
import type {
  EarningsQualityFeature,
  GapOverheatFeature,
  FollowThroughFeature,
  MarketRegimeFeature,
  RelativeStrengthFeature,
} from './advancedFilters.js';

/** The advanced-filter feature blob persisted at entry (TradeEpisode.featuresAtEntryJson). */
export interface EntryFeatureBlob {
  earningsQuality?: EarningsQualityFeature | null;
  gapOverheat?: GapOverheatFeature | null;
  followThrough?: FollowThroughFeature | null;
  marketRegime?: MarketRegimeFeature | null;
  relativeStrength?: RelativeStrengthFeature | null;
}

export interface LossClassificationInput {
  pnlJpy: number;
  exitReason: string | null;
  features: EntryFeatureBlob;
}

export interface OutcomeLabels {
  outcome: 'win' | 'loss';
  lossType: LossType | null;
}

/**
 * Classify why a trade lost (or mark it a win). Pure function used post-backtest.
 * Loss attribution priority follows the spec; the first matching rule wins.
 */
export function classifyOutcome(input: LossClassificationInput): OutcomeLabels {
  if (input.pnlJpy >= 0) return { outcome: 'win', lossType: null };

  const f = input.features;
  const exit = (input.exitReason ?? '').toLowerCase();

  if ((f.gapOverheat?.postEarningsGapPct ?? 0) >= 12) {
    return { outcome: 'loss', lossType: 'chased_gap_up' };
  }
  if (f.earningsQuality && f.earningsQuality.score < 60) {
    return { outcome: 'loss', lossType: 'weak_earnings_quality' };
  }
  if (f.marketRegime?.regime === 'risk_off') {
    return { outcome: 'loss', lossType: 'market_regime_bad' };
  }
  if (f.followThrough && f.followThrough.passed === false) {
    return { outcome: 'loss', lossType: 'no_follow_through' };
  }
  if (f.relativeStrength && f.relativeStrength.score < 40) {
    return { outcome: 'loss', lossType: 'low_relative_strength' };
  }
  if (exit.includes('25') || exit.includes('thesis') || exit.includes('invalidat') || exit.includes('trailing')) {
    return { outcome: 'loss', lossType: 'thesis_broken' };
  }
  if (exit.includes('stop_loss') || exit.includes('stop loss') || exit.includes('損切')) {
    return { outcome: 'loss', lossType: 'stop_loss_normal' };
  }
  return { outcome: 'loss', lossType: 'unknown' };
}
