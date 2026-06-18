import type {
  AgentDecision,
  AgentTaskType,
  RunType,
  StrategyKind,
} from './index.js';
import type { Candidate } from '../strategy/candidates.js';

/** Market regime hint passed to the agent (placeholder logic in MVP). */
export interface MarketRegime {
  indexTrend: 'up' | 'down' | 'sideways' | 'unknown';
  riskOn: boolean;
  comment: string;
}

export interface AgentAccountView {
  initialCapitalJpy: number;
  cashJpy: number;
  equityJpy: number;
  buyingPowerJpy: number;
  allowMargin: boolean;
  totalExposureJpy: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
}

export interface AgentRiskView {
  maxSinglePositionPct: number;
  maxTotalExposurePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopPct: number;
  allowNampin: boolean;
  allowMarketBuy: boolean;
  minConfidenceToTrade: number;
}

export interface AgentPositionView {
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnlJpy: number;
  unrealizedPnlPct: number;
  entryReason: string;
  strategy: string;
  stopLossPrice: number | null;
  highestPriceSinceEntry: number | null;
  /** Calendar days held — lets the AI spot dead money ("promising but flat for a month"). */
  holdingDays: number;
  /** The position re-scored as a candidate TODAY (null if it no longer screens). Compare
   *  against candidate scores to judge whether a new name's expected value beats this holding. */
  currentScore: number | null;
  /** Today's screening reasons for the holding (empty if it no longer qualifies). */
  currentSignals: string[];
  /** % below the peak since entry — a fading/stalling signal (0 = still at its high). */
  pctOffHighSinceEntry: number | null;
}

/** Advisory direction from the human operator. The AI should respect it within
 *  the risk rules — it is guidance, not a command to break discipline. */
export interface HumanGuidance {
  /** Overall risk appetite the user picked. */
  stance: 'cautious' | 'balanced' | 'aggressive';
  /** Free-text wishes, e.g. "決算前は買わない", "利益は早めに確定". */
  notes: string;
}

/** The full context object handed to HermesAgent for every task. */
export interface AgentTaskContext {
  backtestTime: string;
  mode: RunType;
  taskType: AgentTaskType;
  account: AgentAccountView;
  riskRules: AgentRiskView;
  positions: AgentPositionView[];
  candidates: Candidate[];
  marketRegime: MarketRegime;
  /** Present when the user has set guidance. */
  humanGuidance?: HumanGuidance;
}

/** Single trading decision returned by the agent. */
export interface AgentTradingDecision {
  decision: AgentDecision;
  symbol: string;
  strategy: StrategyKind;
  budgetJpy: number | null;
  limitPrice: number | null;
  sellPositionPct: number | null;
  confidence: number;
  expectedHoldingDays: number | null;
  stopLossPct: number | null;
  reason: string;
  /** reasons the agent considered NOT buying (>=1 required; detailed on skip) */
  doNotBuyReasons: string[];
  thesis: string;
  riskFactors: string[];
  invalidationConditions: string[];
}

/** Result of a task that may yield zero or more decisions (+ a watchlist). */
export interface AgentTaskResult {
  taskType: AgentTaskType;
  decisions: AgentTradingDecision[];
  watchlistSymbols: string[];
  notes: string;
}

/** Narrow context for a single-symbol decision (used by runTradingDecision). */
export interface AgentTradingContext {
  base: AgentTaskContext;
  candidate: Candidate | null;
  position: AgentPositionView | null;
}
