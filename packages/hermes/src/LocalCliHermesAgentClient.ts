import { execFile } from 'child_process';
import { promisify } from 'util';
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

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = join(__dirname, '../prompts');

export class LocalCliHermesAgentClient implements HermesAgentClient {
  private readonly fallback = new MockHermesAgentClient();

  constructor(
    private readonly config: {
      cliPath?: string;
      model?: string;
      provider?: string;
    } = {}
  ) {}

  private getCliPath(): string {
    return this.config.cliPath || process.env.HERMES_CLI_PATH || '/Users/yu-ga/.local/bin/hermes';
  }

  private getModel(): string | undefined {
    return this.config.model || process.env.HERMES_AGENT_MODEL;
  }

  private getProvider(): string | undefined {
    return this.config.provider || process.env.HERMES_AGENT_PROVIDER;
  }

  private async loadPromptFile(filename: string): Promise<string> {
    try {
      const filePath = join(PROMPTS_DIR, filename);
      return await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      console.warn(`[LocalCliHermesAgentClient] Failed to load prompt file ${filename}:`, err);
      return '';
    }
  }

  private async executeHermes(promptText: string): Promise<string> {
    const cliPath = this.getCliPath();
    const model = this.getModel();
    const provider = this.getProvider();

    const args = ['-z', promptText];
    if (model) {
      args.push('-m', model);
    }
    if (provider) {
      args.push('--provider', provider);
    }

    console.log(`[LocalCliHermesAgentClient] Executing ${cliPath} with model ${model ?? 'default'} (provider: ${provider ?? 'default'})`);
    const { stdout, stderr } = await execFileAsync(cliPath, args, {
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    if (stderr && stderr.trim().length > 0) {
      console.warn(`[LocalCliHermesAgentClient] stderr:`, stderr);
    }

    return stdout;
  }

  private normalizeDecision(decision: any, symbolStrategyMap?: Map<string, string>): any {
    if (!decision || typeof decision !== 'object') return decision;

    // Normalize 'decision' field (often alias as 'action' by LLM)
    if (decision.decision === undefined && decision.action !== undefined) {
      decision.decision = decision.action;
    }

    // Normalize 'strategy' field (often omitted by LLM)
    const validStrategies = ['earnings_momentum', 'new_high_breakout', 'roe_growth', 'risk_management'];
    if (decision.strategy === undefined || !validStrategies.includes(decision.strategy)) {
      if (decision.symbol && symbolStrategyMap && symbolStrategyMap.has(decision.symbol)) {
        decision.strategy = symbolStrategyMap.get(decision.symbol);
      } else {
        decision.strategy = 'new_high_breakout';
      }
    }

    const nullableFields = [
      'budgetJpy',
      'limitPrice',
      'sellPositionPct',
      'expectedHoldingDays',
      'stopLossPct'
    ];
    for (const field of nullableFields) {
      if (decision[field] === undefined) {
        decision[field] = null;
      }
    }
    if (!decision.doNotBuyReasons || !Array.isArray(decision.doNotBuyReasons) || decision.doNotBuyReasons.length === 0) {
      decision.doNotBuyReasons = ['特になし'];
    }
    if (decision.thesis === undefined || decision.thesis === null) {
      decision.thesis = '';
    }
    if (!decision.riskFactors || !Array.isArray(decision.riskFactors)) {
      decision.riskFactors = [];
    }
    if (!decision.invalidationConditions || !Array.isArray(decision.invalidationConditions)) {
      decision.invalidationConditions = [];
    }
    return decision;
  }

  private extractAndParseJson<T>(text: string, schema: { parse: (v: unknown) => T }, symbolStrategyMap?: Map<string, string>): T {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || start >= end) {
      throw new Error(`No JSON object found in response: ${text}`);
    }
    const jsonStr = text.substring(start, end + 1);
    let parsed: any = JSON.parse(jsonStr);

    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.decisions)) {
        parsed.decisions = parsed.decisions.map((d: any) => this.normalizeDecision(d, symbolStrategyMap));
      }
      if (parsed.decision !== undefined || parsed.action !== undefined) {
        parsed = this.normalizeDecision(parsed, symbolStrategyMap);
      }
    }

    return schema.parse(parsed);
  }

  async runTradingTask(context: AgentTaskContext): Promise<AgentTaskResult> {
    try {
      const symbolStrategyMap = new Map<string, string>();
      if (context.candidates) {
        for (const c of context.candidates) {
          symbolStrategyMap.set(c.symbol, c.strategy);
        }
      }

      let promptFile = 'kenmo-trader.md';
      if (context.taskType === 'prepare_watchlist' || context.taskType === 'after_close_analysis') {
        promptFile = 'kenmo-researcher.md';
      }

      const instructions = await this.loadPromptFile(promptFile);
      
      // candidates が多い場合は、スコア上位15件に絞る（E2BIGエラー回避およびトークン節約のため）
      let filteredContext = context;
      if (context.candidates && context.candidates.length > 15) {
        const sorted = [...context.candidates].sort((a, b) => b.score - a.score);
        filteredContext = {
          ...context,
          candidates: sorted.slice(0, 15)
        };
      }

      const promptText = `${instructions}\n\n# Context Data\n\`\`\`json\n${JSON.stringify(filteredContext, null, 2)}\n\`\`\`\n\nPlease respond ONLY with a JSON object matching the required schema. Note that nullable fields like budgetJpy, limitPrice, sellPositionPct, expectedHoldingDays, stopLossPct must NOT be omitted; if they are not applicable, explicitly set them to null.`;

      const response = await this.executeHermes(promptText);
      console.log(`[LocalCliHermesAgentClient] runTradingTask Raw Response:\n${response}\n---`);
      return this.extractAndParseJson(response, agentTaskResultSchema, symbolStrategyMap);
    } catch (err) {
      console.error(`[LocalCliHermesAgentClient] runTradingTask failed, falling back to Mock:`, err);
      return this.fallback.runTradingTask(context);
    }
  }

  async runTradingDecision(context: AgentTradingContext): Promise<AgentTradingDecision> {
    try {
      const symbolStrategyMap = new Map<string, string>();
      if (context.candidate) {
        symbolStrategyMap.set(context.candidate.symbol, context.candidate.strategy);
      }
      if (context.position) {
        symbolStrategyMap.set(context.position.symbol, 'risk_management');
      }

      const instructions = await this.loadPromptFile('kenmo-trader.md');
      const promptText = `${instructions}\n\n# Context Data\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nPlease respond ONLY with a JSON object matching the required schema. Note that nullable fields like budgetJpy, limitPrice, sellPositionPct, expectedHoldingDays, stopLossPct must NOT be omitted; if they are not applicable, explicitly set them to null.`;

      const response = await this.executeHermes(promptText);
      console.log(`[LocalCliHermesAgentClient] runTradingDecision Raw Response:\n${response}\n---`);
      return this.extractAndParseJson(response, agentTradingDecisionSchema, symbolStrategyMap);
    } catch (err) {
      console.error(`[LocalCliHermesAgentClient] runTradingDecision failed, falling back to Mock:`, err);
      return this.fallback.runTradingDecision(context);
    }
  }

  async reviewBacktest(summary: BacktestSummaryForAI): Promise<EvolutionProposalJson> {
    try {
      const instructions = await this.loadPromptFile('kenmo-evolution.md');
      const promptText = `${instructions}\n\n# Context Data\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\nPlease respond ONLY with a JSON object matching the required schema.`;

      const response = await this.executeHermes(promptText);
      console.log(`[LocalCliHermesAgentClient] reviewBacktest Raw Response:\n${response}\n---`);
      return this.extractAndParseJson(response, evolutionProposalSchema);
    } catch (err) {
      console.error(`[LocalCliHermesAgentClient] reviewBacktest failed, falling back to Mock:`, err);
      return this.fallback.reviewBacktest(summary);
    }
  }

  async proposeChallenger(input: ChallengerProposalInput): Promise<ChallengerProposalResult> {
    try {
      const instructions = await this.loadPromptFile('kenmo-evolution.md');
      const promptText = `${instructions}\n\n# Context Data\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\nPlease respond ONLY with a JSON object matching the required schema.`;

      const response = await this.executeHermes(promptText);
      console.log(`[LocalCliHermesAgentClient] proposeChallenger Raw Response:\n${response}\n---`);
      return this.extractAndParseJson(response, challengerProposalResultSchema);
    } catch (err) {
      console.error(`[LocalCliHermesAgentClient] proposeChallenger failed, falling back to Mock:`, err);
      return this.fallback.proposeChallenger(input);
    }
  }
}
