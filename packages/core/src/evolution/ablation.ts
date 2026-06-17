import type { AdvancedFiltersConfig, StrategyConfig } from '../types/index.js';

export type AblationVariantName =
  | 'base'
  | 'earnings-quality-only'
  | 'gap-overheat-only'
  | 'follow-through-only'
  | 'market-regime-only'
  | 'relative-strength-only'
  | 'quality-gap-followthrough'
  | 'all-selected-advanced-filters';

export interface AblationVariant {
  name: AblationVariantName;
  config: StrategyConfig;
}

function clone(config: StrategyConfig): StrategyConfig {
  return JSON.parse(JSON.stringify(config)) as StrategyConfig;
}

function setEnabled(
  config: StrategyConfig,
  flags: Partial<Record<keyof AdvancedFiltersConfig, boolean>>,
): StrategyConfig {
  const c = clone(config);
  const af = c.advancedFilters;
  af.earningsQuality.enabled = flags.earningsQuality ?? false;
  af.gapOverheat.enabled = flags.gapOverheat ?? false;
  af.followThrough.enabled = flags.followThrough ?? false;
  af.marketRegime.enabled = flags.marketRegime ?? false;
  af.relativeStrength.enabled = flags.relativeStrength ?? false;
  return c;
}

/**
 * Build the ablation matrix: the same base strategy with individual advanced
 * filters toggled, so a backtest of each reveals which filter actually moved PnL.
 * `base` keeps the source config's flags as-is (the incoming Champion).
 */
export function generateAblationVariants(base: StrategyConfig): AblationVariant[] {
  return [
    { name: 'base', config: clone(base) },
    { name: 'earnings-quality-only', config: setEnabled(base, { earningsQuality: true }) },
    { name: 'gap-overheat-only', config: setEnabled(base, { gapOverheat: true }) },
    { name: 'follow-through-only', config: setEnabled(base, { followThrough: true, gapOverheat: true }) },
    { name: 'market-regime-only', config: setEnabled(base, { marketRegime: true }) },
    { name: 'relative-strength-only', config: setEnabled(base, { relativeStrength: true }) },
    {
      name: 'quality-gap-followthrough',
      config: setEnabled(base, { earningsQuality: true, gapOverheat: true, followThrough: true }),
    },
    {
      name: 'all-selected-advanced-filters',
      config: setEnabled(base, {
        earningsQuality: true,
        gapOverheat: true,
        followThrough: true,
        marketRegime: true,
        relativeStrength: true,
      }),
    },
  ];
}
