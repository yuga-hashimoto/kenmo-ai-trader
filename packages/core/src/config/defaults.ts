import type { StrategyConfig } from '../types/index.js';

/**
 * Default kenmo-v1 strategy configuration. Challenger strategies are produced by
 * deep-cloning this and mutating individual fields (see evolution engine).
 */
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  risk: {
    maxSinglePositionPct: 25,
    maxTotalExposurePct: 80,
    stopLossPct: 8,
    takeProfitPct: 20,
    takeProfitSellPct: 25,
    trailingStopPct: 12,
    allowNampin: false,
    allowMarketBuy: false,
    maxLeverageIfMarginEnabled: 2.0,
    commissionBps: 5,
    slippageBps: 10,
    minConfidenceToTrade: 0.6,
    maxOrdersPerDay: 5,
    exitBelowMa25: true,
  },
  universe: {
    minMarketCapJpy: 5_000_000_000,
    maxMarketCapJpy: 150_000_000_000,
    minTurnover20dAvgJpy: 50_000_000,
    minPriceJpy: 100,
    maxPriceJpy: 5_000,
  },
  scheduler: {
    preMarketTime: '08:30',
    marketOpenTime: '09:00',
    lunchStartTime: '11:30',
    lunchEndTime: '12:30',
    marketCloseTime: '15:30',
    afterCloseTime: '15:40',
    monitorIntervalMinutes: 15,
    disableFirstMinutesAfterOpen: 5,
    disableNewBuyMinutesBeforeClose: 10,
  },
  scoring: {
    minEarningsMomentumScore: 60,
    minBreakoutScore: 60,
    minRoeGrowthScore: 55,
    minVolumeRatioForBreakout: 1.5,
    minVolumeRatioForEarnings: 2.0,
  },
  advancedFilters: {
    earningsQuality: {
      enabled: true,
      weight: 20,
      minScoreToBuy: 60,
      penalizeNoSalesGrowth: true,
      penalizeOneTimeProfit: true,
      penalizeOperatingMarginDeterioration: true,
    },
    gapOverheat: {
      enabled: true,
      gapSoftPenaltyPct: 8,
      gapWaitThresholdPct: 12,
      gapStrongPenaltyPct: 15,
      gapNoBuyPct: 20,
      noBuyStopHigh: true,
    },
    followThrough: {
      enabled: true,
      minDaysAfterEarnings: 2,
      maxDaysAfterEarnings: 5,
      requireAboveEarningsDayLow: true,
      minVolumeRatio20d: 1.5,
      requireAboveMa25: true,
      allowImmediateBuyIfHighQualityAndNotOverheated: true,
    },
    marketRegime: {
      enabled: true,
      reduceExposureBelowMa25: true,
      stopNewBuyBelowMa75: true,
      badRegimePositionSizeMultiplier: 0.5,
    },
    relativeStrength: {
      enabled: true,
      lookbackDaysShort: 20,
      lookbackDaysLong: 60,
      compareWithMarketIndex: true,
    },
    lossTypeClassification: { enabled: true },
    ablationTest: { enabled: true },
  },
};

export function cloneStrategyConfig(config: StrategyConfig): StrategyConfig {
  return JSON.parse(JSON.stringify(config)) as StrategyConfig;
}
