import type {
  AgentTaskContext,
  AgentTaskResult,
  AgentTradingContext,
  AgentTradingDecision,
} from '@kenmo/core';
import type { BacktestSummaryForAI } from '@kenmo/core';
import type { ChallengerProposalResult, EvolutionProposalJson } from './schemas.js';

export interface ChallengerProposalInput {
  championName: string;
  championConfigJson: unknown;
  summary: BacktestSummaryForAI;
}

/**
 * The contract every HermesAgent backend implements. The trading engine talks
 * only to this interface — never to a model SDK or broker directly.
 */
export interface HermesAgentClient {
  runTradingTask(context: AgentTaskContext): Promise<AgentTaskResult>;
  runTradingDecision(context: AgentTradingContext): Promise<AgentTradingDecision>;
  reviewBacktest(summary: BacktestSummaryForAI): Promise<EvolutionProposalJson>;
  proposeChallenger(input: ChallengerProposalInput): Promise<ChallengerProposalResult>;
}

export type { ChallengerProposalResult, EvolutionProposalJson };
