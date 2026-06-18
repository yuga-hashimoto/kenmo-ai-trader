import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs/promises';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = join(__dirname, '../prompts');

const NULLABLE_DECISION_FIELDS = [
  'budgetJpy',
  'limitPrice',
  'sellPositionPct',
  'expectedHoldingDays',
  'stopLossPct',
] as const;
const VALID_STRATEGIES = ['earnings_momentum', 'new_high_breakout', 'roe_growth', 'risk_management'];

export interface OpenAICompatConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Generic OpenAI-compatible HermesAgent backend. Builds the same kenmo prompts as
 * the local CLI client but talks to any `/chat/completions` endpoint (OpenCode Go,
 * OpenRouter, OpenAI, a local proxy, …) selected purely from env. Every call has an
 * AbortController timeout and falls back to the deterministic mock on any failure,
 * so a slow/unreachable provider can never hang the live trading loop.
 */
export class OpenAICompatHermesAgentClient implements HermesAgentClient {
  private readonly fallback = new MockHermesAgentClient();
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  // Audit: which backend answered the most recent runTradingTask, and why if mock.
  private lastBackend: 'api' | 'mock' = 'api';
  private lastError: string | null = null;

  lastCallInfo(): { backend: string; error: string | null } {
    return { backend: this.lastBackend, error: this.lastError };
  }

  constructor(config: OpenAICompatConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'https://opencode.ai/zen/go/v1').replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'deepseek-v4-flash';
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private async loadPromptFile(filename: string): Promise<string> {
    try {
      return await fs.readFile(join(PROMPTS_DIR, filename), 'utf-8');
    } catch {
      return '';
    }
  }

  /** POST a single user message to the chat-completions endpoint and return the text. */
  private async complete(promptText: string): Promise<string> {
    if (!this.apiKey) throw new Error('AI_API_KEY not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [{ role: 'user', content: promptText }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`AI API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI API returned empty content');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeDecision(
    decision: Record<string, unknown>,
    symbolStrategyMap?: Map<string, string>,
  ): Record<string, unknown> {
    if (!decision || typeof decision !== 'object') return decision;
    const d = decision;
    if (d.decision === undefined && d.action !== undefined) d.decision = d.action;
    if (d.strategy === undefined || !VALID_STRATEGIES.includes(d.strategy as string)) {
      const sym = d.symbol as string | undefined;
      d.strategy = sym && symbolStrategyMap?.has(sym) ? symbolStrategyMap.get(sym) : 'new_high_breakout';
    }
    for (const field of NULLABLE_DECISION_FIELDS) {
      if (d[field] === undefined) d[field] = null;
    }
    if (!Array.isArray(d.doNotBuyReasons) || (d.doNotBuyReasons as unknown[]).length === 0) {
      d.doNotBuyReasons = ['特になし'];
    }
    if (d.thesis === undefined || d.thesis === null) d.thesis = '';
    if (!Array.isArray(d.riskFactors)) d.riskFactors = [];
    if (!Array.isArray(d.invalidationConditions)) d.invalidationConditions = [];
    return d;
  }

  private extractAndParseJson<T>(
    text: string,
    schema: { parse: (v: unknown) => T },
    opts: { symbolStrategyMap?: Map<string, string>; taskTypeDefault?: string } = {},
  ): T {
    const { symbolStrategyMap, taskTypeDefault } = opts;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || start >= end) {
      throw new Error(`No JSON object found in response: ${text.slice(0, 300)}`);
    }
    let parsed = JSON.parse(text.substring(start, end + 1)) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.decisions)) {
        parsed.decisions = (parsed.decisions as Record<string, unknown>[]).map((d) =>
          this.normalizeDecision(d, symbolStrategyMap),
        );
      }
      if (parsed.decision !== undefined || parsed.action !== undefined) {
        parsed = this.normalizeDecision(parsed, symbolStrategyMap);
      }
      // For task results the LLM often omits the top-level envelope fields.
      if (taskTypeDefault) {
        if (parsed.taskType === undefined) parsed.taskType = taskTypeDefault;
        if (!Array.isArray(parsed.decisions)) parsed.decisions = [];
        if (!Array.isArray(parsed.watchlistSymbols)) parsed.watchlistSymbols = [];
        if (typeof parsed.notes !== 'string') parsed.notes = '';
      }
    }
    return schema.parse(parsed);
  }

  private buildPrompt(instructions: string, context: unknown): string {
    return `${instructions}\n\n# Context Data\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nPlease respond ONLY with a JSON object matching the required schema. Note that nullable fields like budgetJpy, limitPrice, sellPositionPct, expectedHoldingDays, stopLossPct must NOT be omitted; if they are not applicable, explicitly set them to null.`;
  }

  async runTradingTask(context: AgentTaskContext): Promise<AgentTaskResult> {
    this.lastBackend = 'api';
    this.lastError = null;
    try {
      const symbolStrategyMap = new Map<string, string>();
      for (const c of context.candidates ?? []) symbolStrategyMap.set(c.symbol, c.strategy);

      const promptFile =
        context.taskType === 'prepare_watchlist' || context.taskType === 'after_close_analysis'
          ? 'kenmo-researcher.md'
          : 'kenmo-trader.md';
      const instructions = await this.loadPromptFile(promptFile);

      // Cap candidates to top-15 by score to bound token usage.
      let filtered = context;
      if (context.candidates && context.candidates.length > 15) {
        const sorted = [...context.candidates].sort((a, b) => b.score - a.score);
        filtered = { ...context, candidates: sorted.slice(0, 15) };
      }

      const response = await this.complete(this.buildPrompt(instructions, filtered));
      return this.extractAndParseJson(response, agentTaskResultSchema, {
        symbolStrategyMap,
        taskTypeDefault: context.taskType,
      });
    } catch (err) {
      this.lastBackend = 'mock';
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error('[OpenAICompatHermesAgentClient] runTradingTask failed, using mock:', err);
      return this.fallback.runTradingTask(context);
    }
  }

  async runTradingDecision(context: AgentTradingContext): Promise<AgentTradingDecision> {
    try {
      const symbolStrategyMap = new Map<string, string>();
      if (context.candidate) symbolStrategyMap.set(context.candidate.symbol, context.candidate.strategy);
      if (context.position) symbolStrategyMap.set(context.position.symbol, 'risk_management');

      const instructions = await this.loadPromptFile('kenmo-trader.md');
      const response = await this.complete(this.buildPrompt(instructions, context));
      return this.extractAndParseJson(response, agentTradingDecisionSchema, { symbolStrategyMap });
    } catch (err) {
      console.error('[OpenAICompatHermesAgentClient] runTradingDecision failed, using mock:', err);
      return this.fallback.runTradingDecision(context);
    }
  }

  async reviewBacktest(summary: BacktestSummaryForAI): Promise<EvolutionProposalJson> {
    try {
      const instructions = await this.loadPromptFile('kenmo-evolution.md');
      const response = await this.complete(this.buildPrompt(instructions, summary));
      return this.extractAndParseJson(response, evolutionProposalSchema);
    } catch (err) {
      console.error('[OpenAICompatHermesAgentClient] reviewBacktest failed, using mock:', err);
      return this.fallback.reviewBacktest(summary);
    }
  }

  async proposeChallenger(input: ChallengerProposalInput): Promise<ChallengerProposalResult> {
    try {
      const instructions = await this.loadPromptFile('kenmo-evolution.md');
      const response = await this.complete(this.buildPrompt(instructions, input));
      return this.extractAndParseJson(response, challengerProposalResultSchema);
    } catch (err) {
      console.error('[OpenAICompatHermesAgentClient] proposeChallenger failed, using mock:', err);
      return this.fallback.proposeChallenger(input);
    }
  }
}
