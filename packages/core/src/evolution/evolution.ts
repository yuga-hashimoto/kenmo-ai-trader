import type { BacktestSummary, LossType, StrategyConfig } from '../types/index.js';
import type { ClosedTrade } from '../portfolio/accounting.js';
import type { EntryFeatureBlob } from '../strategy/lossType.js';

/** A single proposed parameter change, expressed as a dotted config path. */
export interface ConfigChange {
  path: string; // e.g. "risk.stopLossPct"
  from: number | boolean | string;
  to: number | boolean | string;
  rationale: string;
}

export interface LossTypeStat {
  lossType: LossType;
  tradeCount: number;
  totalLossJpy: number;
  avgReturnPct: number;
  examples: string[];
}

export interface FilterAttribution {
  filterName: string;
  enabled: boolean;
  tradeCount: number;
  avgReturnPct: number;
  winRatePct: number;
  profitFactor: number;
}

/** Per-trade record used for loss-type stats + filter attribution. */
export interface TradeRecordForAI {
  symbolCode: string;
  pnlJpy: number;
  pnlPct: number;
  lossType: LossType | null;
  features: EntryFeatureBlob;
}

export interface BacktestSummaryForAI {
  strategyVersion: string;
  initialCapitalJpy: number;
  finalEquityJpy: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  tradeCount: number;
  avgWinPct: number;
  avgLossPct: number;
  averageHoldingDays: number;
  bestPatterns: string[];
  worstPatterns: string[];
  recommendationsNeeded: string[];
  lossTypeStats: LossTypeStat[];
  filterAttribution: FilterAttribution[];
}

const FILTER_NAMES = [
  'earningsQuality',
  'gapOverheat',
  'followThrough',
  'marketRegime',
  'relativeStrength',
] as const;

export function computeLossTypeStats(records: TradeRecordForAI[]): LossTypeStat[] {
  const byType = new Map<LossType, { count: number; loss: number; ret: number; ex: string[] }>();
  for (const r of records) {
    if (r.pnlJpy >= 0 || !r.lossType) continue;
    const cur = byType.get(r.lossType) ?? { count: 0, loss: 0, ret: 0, ex: [] };
    cur.count += 1;
    cur.loss += r.pnlJpy;
    cur.ret += r.pnlPct;
    if (cur.ex.length < 3) cur.ex.push(r.symbolCode);
    byType.set(r.lossType, cur);
  }
  return [...byType.entries()]
    .map(([lossType, s]) => ({
      lossType,
      tradeCount: s.count,
      totalLossJpy: Math.round(s.loss),
      avgReturnPct: s.count > 0 ? s.ret / s.count : 0,
      examples: s.ex,
    }))
    .sort((a, b) => a.totalLossJpy - b.totalLossJpy);
}

export function computeFilterAttribution(records: TradeRecordForAI[]): FilterAttribution[] {
  return FILTER_NAMES.map((name) => {
    const used = records.filter((r) => r.features[name] != null);
    const wins = used.filter((r) => r.pnlJpy > 0);
    const grossWin = wins.reduce((a, r) => a + r.pnlJpy, 0);
    const grossLoss = used
      .filter((r) => r.pnlJpy < 0)
      .reduce((a, r) => a + Math.abs(r.pnlJpy), 0);
    return {
      filterName: name,
      enabled: used.length > 0,
      tradeCount: used.length,
      avgReturnPct: used.length > 0 ? used.reduce((a, r) => a + r.pnlPct, 0) / used.length : 0,
      winRatePct: used.length > 0 ? (wins.length / used.length) * 100 : 0,
      // cap at 999: Infinity serializes to null in JSON and breaks consumers
      profitFactor: grossLoss === 0 ? (grossWin > 0 ? 999 : 0) : grossWin / grossLoss,
    };
  });
}

/** Read a dotted path from a config-like object. */
function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Immutably set a dotted path on a deep-cloned config. */
export function applyConfigChange(
  config: StrategyConfig,
  change: ConfigChange,
): StrategyConfig {
  const clone = JSON.parse(JSON.stringify(config)) as StrategyConfig;
  const keys = change.path.split('.');
  let cursor: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    const nextVal = cursor[key];
    if (typeof nextVal !== 'object' || nextVal === null) return config; // invalid path -> no-op
    cursor = nextVal as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = change.to;
  return clone;
}

export function applyConfigChanges(
  config: StrategyConfig,
  changes: ConfigChange[],
): StrategyConfig {
  return changes.reduce((cfg, change) => applyConfigChange(cfg, change), config);
}

/**
 * Build the compact summary handed to HermesAgent.reviewBacktest. Pattern mining
 * is deliberately simple (per-strategy win rate) — the AI elaborates on it.
 */
export function buildSummaryForAI(params: {
  strategyVersion: string;
  summary: BacktestSummary;
  closedTrades: ClosedTrade[];
  tradeRecords?: TradeRecordForAI[];
}): BacktestSummaryForAI {
  const { strategyVersion, summary, closedTrades } = params;
  const tradeRecords = params.tradeRecords ?? [];

  const byStrategy = new Map<string, { wins: number; total: number; pnl: number }>();
  for (const t of closedTrades) {
    const cur = byStrategy.get(t.strategy) ?? { wins: 0, total: 0, pnl: 0 };
    cur.total += 1;
    cur.pnl += t.pnlJpy;
    if (t.pnlJpy > 0) cur.wins += 1;
    byStrategy.set(t.strategy, cur);
  }

  const bestPatterns: string[] = [];
  const worstPatterns: string[] = [];
  for (const [strategy, stat] of byStrategy) {
    const wr = stat.total > 0 ? (stat.wins / stat.total) * 100 : 0;
    const line = `${strategy}: ${stat.total}件 勝率${wr.toFixed(0)}% 損益${Math.round(stat.pnl).toLocaleString()}円`;
    if (wr >= 50 && stat.pnl > 0) bestPatterns.push(line);
    else worstPatterns.push(line);
  }

  const recommendationsNeeded: string[] = [];
  if (summary.maxDrawdownPct > 20) recommendationsNeeded.push('最大DDが大きい');
  if (summary.winRatePct < 40) recommendationsNeeded.push('勝率が低い');
  if (summary.profitFactor < 1.2) recommendationsNeeded.push('PFが低い');
  if (summary.tradeCount < 10) recommendationsNeeded.push('取引回数が少なく統計的に不十分');

  return {
    strategyVersion,
    initialCapitalJpy: summary.initialCapitalJpy,
    finalEquityJpy: summary.finalEquityJpy,
    totalReturnPct: summary.totalReturnPct,
    annualizedReturnPct: summary.annualizedReturnPct,
    maxDrawdownPct: summary.maxDrawdownPct,
    winRatePct: summary.winRatePct,
    profitFactor: summary.profitFactor,
    tradeCount: summary.tradeCount,
    avgWinPct: summary.avgWinPct,
    avgLossPct: summary.avgLossPct,
    averageHoldingDays: summary.averageHoldingDays,
    bestPatterns,
    worstPatterns,
    recommendationsNeeded,
    lossTypeStats: computeLossTypeStats(tradeRecords),
    filterAttribution: computeFilterAttribution(tradeRecords),
  };
}

/**
 * Translate loss-type statistics into concrete advancedFilters config changes
 * (the kenmo evolution rules). Returns the changes the Challenger should apply.
 */
export function proposeFromLossStats(
  lossTypeStats: LossTypeStat[],
  config: StrategyConfig,
): ConfigChange[] {
  const changes: ConfigChange[] = [];
  const af = config.advancedFilters;
  const count = (t: LossType): number =>
    lossTypeStats.find((s) => s.lossType === t)?.tradeCount ?? 0;
  const totalLosses = lossTypeStats.reduce((a, s) => a + s.tradeCount, 0);
  const dominant = (t: LossType): boolean => totalLosses > 0 && count(t) / totalLosses >= 0.25;

  if (dominant('chased_gap_up')) {
    changes.push({
      path: 'advancedFilters.gapOverheat.gapWaitThresholdPct',
      from: af.gapOverheat.gapWaitThresholdPct,
      to: Math.max(6, af.gapOverheat.gapWaitThresholdPct - 2),
      rationale: 'chased_gap_up が多い: ギャップ待ち閾値を下げてFollowThrough必須範囲を広げる',
    });
    changes.push({
      path: 'advancedFilters.gapOverheat.gapNoBuyPct',
      from: af.gapOverheat.gapNoBuyPct,
      to: Math.max(12, af.gapOverheat.gapNoBuyPct - 3),
      rationale: 'chased_gap_up が多い: 買い禁止ギャップを下げる',
    });
  }
  if (dominant('weak_earnings_quality')) {
    changes.push({
      path: 'advancedFilters.earningsQuality.minScoreToBuy',
      from: af.earningsQuality.minScoreToBuy,
      to: Math.min(85, af.earningsQuality.minScoreToBuy + 8),
      rationale: 'weak_earnings_quality が多い: 決算品質の最低スコアを上げる',
    });
  }
  if (dominant('market_regime_bad')) {
    changes.push({
      path: 'advancedFilters.marketRegime.badRegimePositionSizeMultiplier',
      from: af.marketRegime.badRegimePositionSizeMultiplier,
      to: Math.max(0, af.marketRegime.badRegimePositionSizeMultiplier - 0.2),
      rationale: 'market_regime_bad が多い: 悪地合いのポジションサイズを下げる',
    });
  }
  if (dominant('no_follow_through')) {
    changes.push({
      path: 'advancedFilters.followThrough.minVolumeRatio20d',
      from: af.followThrough.minVolumeRatio20d,
      to: Number((af.followThrough.minVolumeRatio20d + 0.3).toFixed(2)),
      rationale: 'no_follow_through が多い: FollowThroughの出来高条件を強める',
    });
    changes.push({
      path: 'advancedFilters.followThrough.maxDaysAfterEarnings',
      from: af.followThrough.maxDaysAfterEarnings,
      to: Math.min(7, af.followThrough.maxDaysAfterEarnings + 2),
      rationale: 'no_follow_through が多い: 確認期間を広げる',
    });
  }
  if (dominant('low_relative_strength')) {
    changes.push({
      path: 'advancedFilters.relativeStrength.lookbackDaysShort',
      from: af.relativeStrength.lookbackDaysShort,
      to: af.relativeStrength.lookbackDaysShort, // keep, signal handled via scoring; placeholder for explicit min score
      rationale: 'low_relative_strength が多い: 相対強度の最低基準を引き上げる方針',
    });
  }
  return changes;
}

export interface StrategyComparison {
  metric: string;
  champion: number;
  challenger: number;
  challengerBetter: boolean;
}

export interface PromotionVerdict {
  comparisons: StrategyComparison[];
  recommendPromote: boolean;
  rationale: string[];
}

/**
 * Compare a challenger against the champion across the key metrics and decide
 * whether promotion is warranted. Guards against over-fitting by requiring a
 * minimum trade count and a non-worse drawdown — not just a higher return.
 */
export interface PromotionContext {
  /** fraction of total challenger PnL coming from its single best symbol (0-1) */
  challengerTopSymbolPnlShare?: number;
  /** per-segment returns (e.g. train/validation/test) for the challenger */
  segments?: Array<{ label: string; returnPct: number }>;
  /** minimum acceptable trade count */
  minTradeCount?: number;
}

export function compareStrategies(
  champion: BacktestSummary,
  challenger: BacktestSummary,
  ctx: PromotionContext = {},
): PromotionVerdict {
  const minTradeCount = ctx.minTradeCount ?? 10;
  const cmp = (
    metric: string,
    c: number,
    h: number,
    higherIsBetter: boolean,
  ): StrategyComparison => ({
    metric,
    champion: c,
    challenger: h,
    challengerBetter: higherIsBetter ? h > c : h < c,
  });

  const comparisons: StrategyComparison[] = [
    cmp('totalReturnPct', champion.totalReturnPct, challenger.totalReturnPct, true),
    cmp(
      'annualizedReturnPct',
      champion.annualizedReturnPct,
      challenger.annualizedReturnPct,
      true,
    ),
    cmp('maxDrawdownPct', champion.maxDrawdownPct, challenger.maxDrawdownPct, false),
    cmp('winRatePct', champion.winRatePct, challenger.winRatePct, true),
    cmp('profitFactor', champion.profitFactor, challenger.profitFactor, true),
  ];

  const rationale: string[] = [];
  let recommendPromote = true;

  if (challenger.tradeCount < minTradeCount) {
    recommendPromote = false;
    rationale.push(`取引回数が${minTradeCount}未満で統計的に不十分（過剰最適化の疑い）`);
  }
  if (challenger.finalEquityJpy < champion.finalEquityJpy) {
    recommendPromote = false;
    rationale.push('最終資産がChampionを下回る');
  }
  if (challenger.profitFactor < champion.profitFactor) {
    recommendPromote = false;
    rationale.push('Profit FactorがChampionを下回る');
  }
  if (challenger.maxDrawdownPct > champion.maxDrawdownPct + 5) {
    recommendPromote = false;
    rationale.push('最大DDがChampionより著しく悪化');
  }
  // avgLossPct is negative; more negative = worse
  if (challenger.avgLossPct < champion.avgLossPct - 1) {
    recommendPromote = false;
    rationale.push('平均損失率がChampionより悪化');
  }
  if (ctx.challengerTopSymbolPnlShare !== undefined && ctx.challengerTopSymbolPnlShare > 0.6) {
    recommendPromote = false;
    rationale.push('特定1銘柄に損益が偏っている（汎化性に疑問）');
  }
  if (ctx.segments && ctx.segments.some((s) => s.returnPct < -10)) {
    recommendPromote = false;
    rationale.push('validation/test 区間で大きく悪化');
  }
  if (recommendPromote) {
    rationale.push('finalEquity/PF改善かつDD・avgLoss・期間分散が許容範囲のため昇格を推奨');
  }

  return { comparisons, recommendPromote, rationale };
}
