import { DEFAULT_STRATEGY_CONFIG, type StrategyConfig } from '@kenmo/core';

/**
 * Parse a stored StrategyVersion.configJson into a StrategyConfig, deep-merging
 * over defaults so older/partial configs still load safely.
 */
export function parseStrategyConfig(json: unknown): StrategyConfig {
  const base = JSON.parse(JSON.stringify(DEFAULT_STRATEGY_CONFIG)) as StrategyConfig;
  if (!json || typeof json !== 'object') return base;
  const obj = json as Record<string, unknown>;
  const af = (obj.advancedFilters as Record<string, object> | undefined) ?? {};
  const baseAf = base.advancedFilters;
  return {
    risk: { ...base.risk, ...((obj.risk as object) ?? {}) },
    universe: { ...base.universe, ...((obj.universe as object) ?? {}) },
    scheduler: { ...base.scheduler, ...((obj.scheduler as object) ?? {}) },
    scoring: { ...base.scoring, ...((obj.scoring as object) ?? {}) },
    advancedFilters: {
      earningsQuality: { ...baseAf.earningsQuality, ...(af.earningsQuality ?? {}) },
      gapOverheat: { ...baseAf.gapOverheat, ...(af.gapOverheat ?? {}) },
      followThrough: { ...baseAf.followThrough, ...(af.followThrough ?? {}) },
      marketRegime: { ...baseAf.marketRegime, ...(af.marketRegime ?? {}) },
      relativeStrength: { ...baseAf.relativeStrength, ...(af.relativeStrength ?? {}) },
      lossTypeClassification: { ...baseAf.lossTypeClassification, ...(af.lossTypeClassification ?? {}) },
      ablationTest: { ...baseAf.ablationTest, ...(af.ablationTest ?? {}) },
    },
  };
}
