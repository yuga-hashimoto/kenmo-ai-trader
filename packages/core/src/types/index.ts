/**
 * Shared domain types for the kenmo-ai-trader core engine.
 *
 * These types are intentionally free of any persistence / framework concerns so
 * that the strategy, risk, fill-simulation and accounting logic can be unit
 * tested in isolation (no Postgres, no Fastify, no Next.js required).
 */

export type RunType = 'backtest' | 'paper' | 'live';
export type TradingMode = RunType;

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'marketable_limit';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected';
export type PositionStatus = 'open' | 'closed';

export type StrategyKind =
  | 'earnings_momentum'
  | 'new_high_breakout'
  | 'roe_growth'
  | 'risk_management';

export type AgentDecision = 'buy' | 'sell' | 'hold' | 'watch' | 'skip';

export type AgentTaskType =
  | 'prepare_watchlist'
  | 'monitor_and_trade'
  | 'pre_lunch_review'
  | 'pre_close_review'
  | 'after_close_analysis'
  | 'review_backtest'
  | 'propose_challenger';

export type GuidanceRevision = 'none' | 'up' | 'down';

/** A single day of OHLCV data. `date` is an ISO yyyy-mm-dd string (JST trading day). */
export interface DailyBar {
  symbolCode: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnoverValue: number;
}

/** Intraday (e.g. 1/5-min) bar. The engine is daily by default but intraday-ready. */
export interface IntradayBar {
  symbolCode: string;
  /** ISO timestamp with JST offset, e.g. 2022-05-10T09:05:00+09:00 */
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FinancialResultData {
  symbolCode: string;
  announcedAt: string;
  fiscalPeriod: string;
  sales: number;
  operatingProfit: number;
  ordinaryProfit: number;
  netIncome: number;
  salesYoyPct: number;
  operatingProfitYoyPct: number;
  operatingMarginPct: number;
  operatingMarginPrevPct: number;
  roePct: number;
  progressRateOpPct: number;
  guidanceRevision: GuidanceRevision;
}

export type DisclosureType =
  | 'earnings'
  | 'guidance_up'
  | 'guidance_down'
  | 'dividend_up'
  | 'midterm_plan'
  | 'monthly'
  | 'other';

export interface DisclosureData {
  symbolCode: string;
  disclosedAt: string;
  disclosureType: DisclosureType;
  title: string;
  summary: string;
}

export interface SymbolData {
  code: string;
  name: string;
  market: string;
  sector: string;
  marketCapJpy: number | null;
  lotSize: number;
  isActive: boolean;
}

/** A complete market dataset used by the in-memory / CSV providers and seed. */
export interface MarketDataset {
  symbols: SymbolData[];
  prices: DailyBar[];
  financials: FinancialResultData[];
  disclosures: DisclosureData[];
}

/* ----------------------------- Risk / config ----------------------------- */

export interface RiskConfig {
  maxSinglePositionPct: number;
  maxTotalExposurePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  takeProfitSellPct: number;
  trailingStopPct: number;
  allowNampin: boolean;
  allowMarketBuy: boolean;
  maxLeverageIfMarginEnabled: number;
  commissionBps: number;
  slippageBps: number;
  minConfidenceToTrade: number;
  maxOrdersPerDay: number;
}

export interface UniverseConfig {
  minMarketCapJpy: number;
  maxMarketCapJpy: number;
  minTurnover20dAvgJpy: number;
  minPriceJpy: number;
  maxPriceJpy: number;
}

export interface SchedulerConfig {
  preMarketTime: string;
  marketOpenTime: string;
  lunchStartTime: string;
  lunchEndTime: string;
  marketCloseTime: string;
  afterCloseTime: string;
  monitorIntervalMinutes: number;
  disableFirstMinutesAfterOpen: number;
  disableNewBuyMinutesBeforeClose: number;
}

export interface StrategyConfig {
  risk: RiskConfig;
  universe: UniverseConfig;
  scheduler: SchedulerConfig;
  /** strategy-specific score thresholds, kept open so challengers can tweak them */
  scoring: {
    minEarningsMomentumScore: number;
    minBreakoutScore: number;
    minRoeGrowthScore: number;
    minVolumeRatioForBreakout: number;
    minVolumeRatioForEarnings: number;
  };
  advancedFilters: AdvancedFiltersConfig;
}

export interface AdvancedFiltersConfig {
  earningsQuality: {
    enabled: boolean;
    weight: number;
    minScoreToBuy: number;
    penalizeNoSalesGrowth: boolean;
    penalizeOneTimeProfit: boolean;
    penalizeOperatingMarginDeterioration: boolean;
  };
  gapOverheat: {
    enabled: boolean;
    gapSoftPenaltyPct: number;
    gapWaitThresholdPct: number;
    gapStrongPenaltyPct: number;
    gapNoBuyPct: number;
    noBuyStopHigh: boolean;
  };
  followThrough: {
    enabled: boolean;
    minDaysAfterEarnings: number;
    maxDaysAfterEarnings: number;
    requireAboveEarningsDayLow: boolean;
    minVolumeRatio20d: number;
    requireAboveMa25: boolean;
    allowImmediateBuyIfHighQualityAndNotOverheated: boolean;
  };
  marketRegime: {
    enabled: boolean;
    reduceExposureBelowMa25: boolean;
    stopNewBuyBelowMa75: boolean;
    badRegimePositionSizeMultiplier: number;
  };
  relativeStrength: {
    enabled: boolean;
    lookbackDaysShort: number;
    lookbackDaysLong: number;
    compareWithMarketIndex: boolean;
  };
  lossTypeClassification: { enabled: boolean };
  ablationTest: { enabled: boolean };
}

/** Code of the synthetic mid/small-cap growth index used by MarketRegimeFilter. */
export const MARKET_INDEX_CODE = 'GROWTH_MOCK';

export type MarketRegimeLabel = 'risk_on' | 'neutral' | 'risk_off';

export type LossType =
  | 'chased_gap_up'
  | 'weak_earnings_quality'
  | 'market_regime_bad'
  | 'no_follow_through'
  | 'stop_loss_normal'
  | 'thesis_broken'
  | 'low_relative_strength'
  | 'unknown';

/* ----------------------------- Broker types ------------------------------ */

export interface AccountState {
  runId: string;
  initialCapitalJpy: number;
  cashJpy: number;
  marketValueJpy: number;
  equityJpy: number;
  buyingPowerJpy: number;
  allowMargin: boolean;
  totalExposureJpy: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
}

export interface PositionState {
  symbolCode: string;
  name?: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnlJpy: number;
  unrealizedPnlPct: number;
  entryReason: string;
  strategy: string;
  stopLossPrice: number | null;
  highestPriceSinceEntry: number | null;
}

export interface OrderState {
  id: string;
  symbolCode: string;
  side: OrderSide;
  orderType: OrderType;
  requestedBudgetJpy: number | null;
  requestedQuantity: number | null;
  finalQuantity: number | null;
  limitPrice: number | null;
  status: OrderStatus;
  reason: string;
  rejectionReason: string | null;
  strategy: string;
  confidence: number;
  createdAt: string;
}

export interface PlaceOrderRequest {
  runType: RunType;
  runId: string;
  agentRunId?: string | null;
  schedulerEventId?: string | null;
  symbolCode: string;
  side: OrderSide;
  orderType: OrderType;
  requestedBudgetJpy?: number | null;
  requestedQuantity?: number | null;
  limitPrice?: number | null;
  /** for sells: fraction of the held position to sell (0-100) */
  sellPositionPct?: number | null;
  reason: string;
  strategy: string;
  confidence: number;
  stopLossPct?: number | null;
  atDate: string;
}

export interface PlaceOrderResult {
  accepted: boolean;
  orderId?: string;
  status: OrderStatus;
  rejectionReason?: string;
}

export interface CancelOrderResult {
  cancelled: boolean;
  reason?: string;
}

/* --------------------------- Scheduler / events -------------------------- */

export interface SchedulerEventContext {
  runType: RunType;
  runId: string;
  eventDate: string;
  virtualTime: string;
  eventType: AgentTaskType;
}

/* ----------------------------- Metrics ----------------------------------- */

export interface TradeResult {
  symbolCode: string;
  strategy: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnlJpy: number | null;
  pnlPct: number | null;
  holdingDays: number | null;
}

export interface BacktestSummary {
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
  bestTrade: TradeResult | null;
  worstTrade: TradeResult | null;
  monthlyReturns: Array<{ month: string; returnPct: number }>;
}
