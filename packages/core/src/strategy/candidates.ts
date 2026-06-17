import type {
  DailyBar,
  FinancialResultData,
  StrategyConfig,
  StrategyKind,
  SymbolData,
} from '../types/index.js';
import {
  distanceTo52wHighPct,
  turnover20dAvgJpy,
  volumeRatio20d,
} from './indicators.js';
import { scoreSymbol } from './scoring.js';
import {
  applyAdvancedFilters,
  computeMarketRegime,
  type AdvancedFiltersResult,
} from './advancedFilters.js';
import { MARKET_INDEX_CODE } from '../types/index.js';

export interface Candidate {
  symbol: string;
  name: string;
  market: string;
  marketCapJpy: number | null;
  close: number;
  volumeRatio20d: number;
  turnover20dAvgJpy: number;
  distanceTo52wHighPct: number;
  /** raw strategy score before advanced-filter adjustment */
  baseScore: number;
  /** ranking/decision score after advanced-filter adjustment */
  score: number;
  strategy: StrategyKind;
  reasons: string[];
  /** advanced-filter feature blocks + buy gate (null when filters disabled) */
  advancedFilters: AdvancedFiltersResult | null;
  buyAllowed: boolean;
  requiresFollowThrough: boolean;
  doNotBuyReasons: string[];
  earnings: {
    salesYoyPct: number;
    operatingProfitYoyPct: number;
    operatingMarginCurrentPct: number;
    operatingMarginPrevPct: number;
    progressRateOpPct: number;
    guidanceRevision: 'none' | 'up' | 'down';
  } | null;
}

export interface SymbolInput {
  symbol: SymbolData;
  /** ascending bars sliced to the "as of" date (no future leakage) */
  bars: DailyBar[];
  /** most recent financial result announced on/before the "as of" date */
  latestFinancial: FinancialResultData | null;
  /** concatenated disclosure titles/summaries up to the "as of" date (for one-time profit detection) */
  disclosureText?: string;
}

export interface GenerateCandidatesOptions {
  /** market index bars (GROWTH_MOCK) up to the "as of" date, for regime + relative strength */
  indexBars?: DailyBar[];
}

/** Liquidity + universe filter. Returns null if the symbol passes, else a reason. */
export function universeFilterReason(
  input: SymbolInput,
  config: StrategyConfig,
): string | null {
  const { universe } = config;
  const last = input.bars[input.bars.length - 1];
  if (!last) return 'no price';
  if (last.close < universe.minPriceJpy) return 'price too low';
  if (last.close > universe.maxPriceJpy) return 'price too high';
  const turnover = turnover20dAvgJpy(input.bars);
  if (turnover !== null && turnover < universe.minTurnover20dAvgJpy) {
    return 'illiquid';
  }
  const cap = input.symbol.marketCapJpy;
  if (cap !== null) {
    if (cap < universe.minMarketCapJpy) return 'market cap too small';
    if (cap > universe.maxMarketCapJpy) return 'market cap too large';
  }
  return null;
}

/**
 * Generate ranked candidates for a given "as of" trading day. Symbols failing
 * the universe/liquidity filter are excluded; the rest are scored and sorted by
 * their best strategy score (descending).
 */
export function generateCandidates(
  inputs: SymbolInput[],
  config: StrategyConfig,
  options: GenerateCandidatesOptions = {},
): Candidate[] {
  const candidates: Candidate[] = [];
  const indexBars = options.indexBars ?? [];
  const marketRegime = config.advancedFilters.marketRegime.enabled
    ? computeMarketRegime(indexBars, config.advancedFilters.marketRegime, MARKET_INDEX_CODE)
    : null;

  for (const input of inputs) {
    if (!input.symbol.isActive) continue;
    if (universeFilterReason(input, config) !== null) continue;

    const last = input.bars[input.bars.length - 1];
    if (!last) continue;

    const scores = scoreSymbol(input.bars, input.latestFinancial, config);
    const breakdown =
      scores.bestStrategy === 'earnings_momentum'
        ? scores.earningsMomentum
        : scores.bestStrategy === 'new_high_breakout'
          ? scores.newHighBreakout
          : scores.roeGrowth;

    const advanced = applyAdvancedFilters(
      {
        bars: input.bars,
        latestFinancial: input.latestFinancial,
        disclosureText: input.disclosureText ?? '',
        indexBars,
        marketRegime,
      },
      config.advancedFilters,
    );
    const baseScore = scores.bestScore;
    const adjustedScore = Math.max(0, Math.min(100, baseScore + advanced.scoreAdjustment));

    const fin = input.latestFinancial;
    candidates.push({
      symbol: input.symbol.code,
      name: input.symbol.name,
      market: input.symbol.market,
      marketCapJpy: input.symbol.marketCapJpy,
      close: last.close,
      volumeRatio20d: volumeRatio20d(input.bars) ?? 1,
      turnover20dAvgJpy: turnover20dAvgJpy(input.bars) ?? 0,
      distanceTo52wHighPct: distanceTo52wHighPct(input.bars) ?? 100,
      baseScore,
      score: adjustedScore,
      strategy: scores.bestStrategy,
      reasons: breakdown.reasons,
      advancedFilters: advanced,
      buyAllowed: advanced.buyAllowed,
      requiresFollowThrough: advanced.requiresFollowThrough,
      doNotBuyReasons: advanced.doNotBuyReasons,
      earnings: fin
        ? {
            salesYoyPct: fin.salesYoyPct,
            operatingProfitYoyPct: fin.operatingProfitYoyPct,
            operatingMarginCurrentPct: fin.operatingMarginPct,
            operatingMarginPrevPct: fin.operatingMarginPrevPct,
            progressRateOpPct: fin.progressRateOpPct,
            guidanceRevision: fin.guidanceRevision,
          }
        : null,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/** A passing-score subset suitable for the watchlist (prepare_watchlist task). */
export function buildWatchlist(
  candidates: Candidate[],
  config: StrategyConfig,
  limit = 20,
): Candidate[] {
  const minScore = Math.min(
    config.scoring.minEarningsMomentumScore,
    config.scoring.minBreakoutScore,
    config.scoring.minRoeGrowthScore,
  );
  return candidates.filter((c) => c.score >= minScore).slice(0, limit);
}
