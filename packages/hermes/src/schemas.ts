import { z } from 'zod';

/** Zod schema for a single AgentTradingDecision. All AI output is validated. */
export const agentTradingDecisionSchema = z.object({
  decision: z.enum(['buy', 'sell', 'hold', 'watch', 'skip']),
  symbol: z.string().min(1),
  strategy: z.enum([
    'earnings_momentum',
    'new_high_breakout',
    'roe_growth',
    'risk_management',
  ]),
  budgetJpy: z.number().nonnegative().nullable(),
  limitPrice: z.number().positive().nullable(),
  sellPositionPct: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  expectedHoldingDays: z.number().int().nonnegative().nullable(),
  stopLossPct: z.number().min(0).max(100).nullable(),
  reason: z.string().min(1),
  // Every decision must surface at least one "reason not to buy" (kenmo discipline).
  doNotBuyReasons: z.array(z.string()).min(1, 'doNotBuyReasons must not be empty'),
  thesis: z.string(),
  riskFactors: z.array(z.string()),
  invalidationConditions: z.array(z.string()),
});

export const agentTaskResultSchema = z.object({
  taskType: z.enum([
    'prepare_watchlist',
    'monitor_and_trade',
    'pre_lunch_review',
    'pre_close_review',
    'after_close_analysis',
    'review_backtest',
    'propose_challenger',
  ]),
  decisions: z.array(agentTradingDecisionSchema),
  watchlistSymbols: z.array(z.string()),
  notes: z.string(),
});

export const configChangeSchema = z.object({
  path: z.string().min(1),
  from: z.union([z.number(), z.boolean(), z.string()]),
  to: z.union([z.number(), z.boolean(), z.string()]),
  rationale: z.string(),
});

export const evolutionProposalSchema = z.object({
  reason: z.string().min(1),
  summary: z.string(),
  bestPatterns: z.array(z.string()),
  worstPatterns: z.array(z.string()),
  configChanges: z.array(configChangeSchema),
  promptNotes: z.string(),
});

export const challengerProposalResultSchema = z.object({
  challengerName: z.string().min(1),
  reason: z.string().min(1),
  configChanges: z.array(configChangeSchema),
  promptVersion: z.string(),
});

export type AgentTradingDecisionJson = z.infer<typeof agentTradingDecisionSchema>;
export type AgentTaskResultJson = z.infer<typeof agentTaskResultSchema>;
export type EvolutionProposalJson = z.infer<typeof evolutionProposalSchema>;
export type ChallengerProposalResult = z.infer<typeof challengerProposalResultSchema>;
