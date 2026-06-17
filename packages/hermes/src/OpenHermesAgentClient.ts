import type {
  AgentTaskContext,
  AgentTaskResult,
  AgentTradingContext,
  AgentTradingDecision,
  BacktestSummaryForAI,
} from '@kenmo/core';
import type { HermesAgentClient, ChallengerProposalInput } from './HermesAgentClient.js';
import {
  agentTaskResultSchema,
  agentTradingDecisionSchema,
  challengerProposalResultSchema,
  evolutionProposalSchema,
  type ChallengerProposalResult,
  type EvolutionProposalJson,
} from './schemas.js';
import { MockHermesAgentClient } from './MockHermesAgentClient.js';
import { LocalCliHermesAgentClient } from './LocalCliHermesAgentClient.js';
import { OpenAICompatHermesAgentClient } from './OpenAICompatHermesAgentClient.js';

export interface OpenHermesConfig {
  endpoint: string | undefined;
  apiKey: string | undefined;
  model: string | undefined;
}

/**
 * Connector to a real HermesAgent backend (an LLM service that returns the same
 * JSON contracts). If the endpoint/key are not configured, it transparently
 * falls back to the deterministic MockHermesAgentClient so the app always runs.
 *
 * The HTTP integration is intentionally minimal and behind a feature check — no
 * credentials are required to use the app, and none are bundled.
 */
export class OpenHermesAgentClient implements HermesAgentClient {
  private readonly fallback = new MockHermesAgentClient();
  private readonly enabled: boolean;

  constructor(private readonly config: OpenHermesConfig) {
    this.enabled = Boolean(config.endpoint && config.apiKey);
  }

  get isRemote(): boolean {
    return this.enabled;
  }

  private async call<T>(path: string, body: unknown, schema: { parse: (v: unknown) => T }): Promise<T | null> {
    if (!this.enabled) return null;
    try {
      const res = await fetch(`${this.config.endpoint}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, ...((body as object) ?? {}) }),
      });
      if (!res.ok) return null;
      const json: unknown = await res.json();
      return schema.parse(json);
    } catch {
      return null;
    }
  }

  async runTradingTask(context: AgentTaskContext): Promise<AgentTaskResult> {
    const remote = await this.call('/v1/trading-task', { context }, agentTaskResultSchema);
    return remote ?? this.fallback.runTradingTask(context);
  }

  async runTradingDecision(context: AgentTradingContext): Promise<AgentTradingDecision> {
    const remote = await this.call('/v1/trading-decision', { context }, agentTradingDecisionSchema);
    return remote ?? this.fallback.runTradingDecision(context);
  }

  async reviewBacktest(summary: BacktestSummaryForAI): Promise<EvolutionProposalJson> {
    const remote = await this.call('/v1/review-backtest', { summary }, evolutionProposalSchema);
    return remote ?? this.fallback.reviewBacktest(summary);
  }

  async proposeChallenger(input: ChallengerProposalInput): Promise<ChallengerProposalResult> {
    const remote = await this.call('/v1/propose-challenger', input, challengerProposalResultSchema);
    return remote ?? this.fallback.proposeChallenger(input);
  }
}

/** Factory: choose the agent backend from env. Defaults to the mock. */
export function createHermesAgentClient(env: NodeJS.ProcessEnv = process.env): HermesAgentClient {
  if (env.HERMES_MODE === 'remote') {
    return new OpenHermesAgentClient({
      endpoint: env.HERMES_AGENT_ENDPOINT,
      apiKey: env.HERMES_AGENT_API_KEY,
      model: env.HERMES_AGENT_MODEL,
    });
  }
  if (env.HERMES_MODE === 'local_cli') {
    return new LocalCliHermesAgentClient({
      cliPath: env.HERMES_CLI_PATH,
      model: env.HERMES_AGENT_MODEL,
      provider: env.HERMES_AGENT_PROVIDER,
    });
  }
  if (env.HERMES_MODE === 'api') {
    return new OpenAICompatHermesAgentClient({
      baseUrl: env.AI_API_BASE_URL,
      apiKey: env.AI_API_KEY,
      model: env.AI_API_MODEL,
      timeoutMs: env.AI_API_TIMEOUT_MS ? Number(env.AI_API_TIMEOUT_MS) : undefined,
    });
  }
  return new MockHermesAgentClient();
}
