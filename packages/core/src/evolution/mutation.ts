import type { StrategyConfig } from '../types/index.js';
import { applyConfigChanges, type ConfigChange } from './evolution.js';

/**
 * Numeric "genes" a challenger may perturb, with the bounds that keep a mutated
 * strategy sane. Only these paths mutate — structural flags and scheduler times
 * are never touched, so every challenger stays a valid kenmo strategy.
 */
export interface Gene {
  path: string;
  min: number;
  max: number;
  /** Perturbation step. One mutation moves a gene ±step (then clamps to bounds). */
  step: number;
  integer?: boolean;
}

export const MUTABLE_GENES: Gene[] = [
  { path: 'risk.minConfidenceToTrade', min: 0.5, max: 0.8, step: 0.05 },
  { path: 'risk.stopLossPct', min: 5, max: 12, step: 1, integer: true },
  { path: 'risk.takeProfitPct', min: 12, max: 30, step: 2, integer: true },
  { path: 'risk.trailingStopPct', min: 8, max: 18, step: 1, integer: true },
  { path: 'risk.takeProfitSellPct', min: 15, max: 50, step: 5, integer: true },
  { path: 'risk.maxSinglePositionPct', min: 15, max: 30, step: 5, integer: true },
  { path: 'risk.maxTotalExposurePct', min: 50, max: 100, step: 10, integer: true },
  { path: 'risk.maxOrdersPerDay', min: 3, max: 8, step: 1, integer: true },
  { path: 'scoring.minBreakoutScore', min: 50, max: 75, step: 5, integer: true },
  { path: 'scoring.minRoeGrowthScore', min: 45, max: 70, step: 5, integer: true },
  { path: 'scoring.minEarningsMomentumScore', min: 50, max: 75, step: 5, integer: true },
  { path: 'scoring.minVolumeRatioForBreakout', min: 1.2, max: 2.5, step: 0.1 },
  { path: 'scoring.minVolumeRatioForEarnings', min: 1.5, max: 3.0, step: 0.25 },
  { path: 'advancedFilters.earningsQuality.minScoreToBuy', min: 40, max: 75, step: 5, integer: true },
  { path: 'advancedFilters.gapOverheat.gapNoBuyPct', min: 15, max: 30, step: 5, integer: true },
  {
    path: 'advancedFilters.marketRegime.badRegimePositionSizeMultiplier',
    min: 0.3,
    max: 0.8,
    step: 0.1,
  },
];

/** Read a numeric gene value out of a config by dotted path. */
export function geneValue(config: StrategyConfig, path: string): number {
  const v = path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], config);
  return typeof v === 'number' ? v : Number.NaN;
}

const round = (v: number, gene: Gene): number =>
  gene.integer ? Math.round(v) : Number(v.toFixed(4));

/** Move a gene one step in a random direction, clamped to its bounds. Returns the same value only if the range can't move. */
function perturb(current: number, gene: Gene, rng: () => number): number {
  const dir = rng() < 0.5 ? -1 : 1;
  let next = round(current + dir * gene.step, gene);
  if (next < gene.min || next > gene.max) next = round(current - dir * gene.step, gene); // bounce off the boundary
  next = Math.min(gene.max, Math.max(gene.min, next));
  if (next === current) {
    // Boundary/precision made it a no-op — jump to the other end of the step.
    const alt = round(current === gene.min ? current + gene.step : current - gene.step, gene);
    next = Math.min(gene.max, Math.max(gene.min, alt));
  }
  return next;
}

/** Count how many mutable genes differ between two configs. */
export function countGeneDiffs(a: StrategyConfig, b: StrategyConfig): number {
  return MUTABLE_GENES.reduce(
    (n, g) => n + (Math.abs(geneValue(a, g.path) - geneValue(b, g.path)) > 1e-9 ? 1 : 0),
    0,
  );
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Produce a mutated copy of `parent` differing by at least `minChanges` genes.
 * Picks distinct genes at random and perturbs each within bounds.
 */
export function mutateConfig(
  parent: StrategyConfig,
  rng: () => number = Math.random,
  minChanges = 2,
): StrategyConfig {
  const want = Math.max(minChanges, 2 + Math.floor(rng() * 2)); // 2–3 genes
  const changes: ConfigChange[] = [];
  for (const gene of shuffle(MUTABLE_GENES, rng)) {
    if (changes.length >= want) break;
    const from = geneValue(parent, gene.path);
    if (!Number.isFinite(from)) continue;
    const to = perturb(from, gene, rng);
    if (to === from) continue; // skip genes that can't actually move
    changes.push({ path: gene.path, from, to, rationale: 'mutation' });
  }
  return applyConfigChanges(parent, changes);
}

/**
 * Generate `n` challenger configs, each ≥2 genes from the parent and ≥1 gene
 * from every other (new or pre-existing) sibling, so the league explores
 * genuinely different strategies rather than near-duplicates.
 */
export function generateDiverseChallengers(
  parent: StrategyConfig,
  n: number,
  existing: StrategyConfig[] = [],
  rng: () => number = Math.random,
): StrategyConfig[] {
  const out: StrategyConfig[] = [];
  const pool = [...existing];
  const maxAttempts = n * 40;
  let attempts = 0;
  while (out.length < n && attempts < maxAttempts) {
    attempts++;
    const candidate = mutateConfig(parent, rng);
    if (countGeneDiffs(parent, candidate) < 2) continue;
    if (pool.some((s) => countGeneDiffs(s, candidate) === 0)) continue; // not distinct
    out.push(candidate);
    pool.push(candidate);
  }
  // Fallback: if diversity was hard to hit, top up with best-effort mutations.
  while (out.length < n) {
    const candidate = mutateConfig(parent, rng, 3);
    out.push(candidate);
    pool.push(candidate);
  }
  return out;
}
