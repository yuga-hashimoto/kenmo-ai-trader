import {
  DEFAULT_STRATEGY_CONFIG,
  proposeFromLossStats,
  type AgentPositionView,
  type AgentTaskContext,
  type AgentTaskResult,
  type AgentTradingContext,
  type AgentTradingDecision,
  type BacktestSummaryForAI,
  type Candidate,
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

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * A complete rule-based HermesAgent. It encodes the kenmo playbook directly so
 * the whole system runs end-to-end with no LLM. Every output is validated with
 * zod before being returned (parse throws on malformed output).
 */
export class MockHermesAgentClient implements HermesAgentClient {
  // Score thresholds the mock uses to convert a candidate into a buy.
  private readonly minScoreToBuy: number;

  constructor(options?: { minScoreToBuy?: number }) {
    this.minScoreToBuy = options?.minScoreToBuy ?? 60;
  }

  async runTradingTask(context: AgentTaskContext): Promise<AgentTaskResult> {
    const decisions: AgentTradingDecision[] = [];
    let notes = '';

    // sells / risk management are evaluated on every trading task
    if (
      context.taskType === 'monitor_and_trade' ||
      context.taskType === 'pre_lunch_review' ||
      context.taskType === 'pre_close_review'
    ) {
      for (const pos of context.positions) {
        const sell = this.evaluateSell(pos, context);
        if (sell) decisions.push(sell);
      }
    }

    // new buys only during monitor_and_trade
    if (context.taskType === 'monitor_and_trade') {
      const held = new Set(context.positions.map((p) => p.symbol));
      let buyCount = 0;
      let evaluated = 0;
      for (const candidate of context.candidates) {
        if (held.has(candidate.symbol)) continue;
        if (evaluated >= 6) break;
        evaluated += 1;
        const buy = this.evaluateBuy(candidate, context);
        if (buy) {
          decisions.push(buy);
          buyCount += 1;
        } else if (candidate.doNotBuyReasons.length > 0 || candidate.score < this.minScoreToBuy) {
          // record an explicit skip with its do-not-buy reasons (kept for analysis)
          decisions.push(this.skip(candidate, context));
        }
        if (buyCount >= 3) break;
      }
    }

    const watchlistSymbols =
      context.taskType === 'prepare_watchlist'
        ? context.candidates.slice(0, 20).map((c) => c.symbol)
        : [];

    if (context.taskType === 'prepare_watchlist') {
      notes = `監視候補 ${watchlistSymbols.length} 件を抽出`;
    } else if (context.taskType === 'after_close_analysis') {
      notes = `当日終了。保有 ${context.positions.length} 件、評価額 ${Math.round(context.account.equityJpy).toLocaleString()}円`;
    } else {
      notes = `${decisions.length} 件の判断`;
    }

    const result: AgentTaskResult = {
      taskType: context.taskType,
      decisions,
      watchlistSymbols,
      notes,
    };
    return agentTaskResultSchema.parse(result);
  }

  async runTradingDecision(context: AgentTradingContext): Promise<AgentTradingDecision> {
    if (context.position) {
      const sell = this.evaluateSell(context.position, context.base);
      if (sell) return agentTradingDecisionSchema.parse(sell);
    }
    if (context.candidate) {
      const buy = this.evaluateBuy(context.candidate, context.base);
      if (buy) return agentTradingDecisionSchema.parse(buy);
    }
    const symbol = context.candidate?.symbol ?? context.position?.symbol ?? 'UNKNOWN';
    const hold: AgentTradingDecision = {
      decision: context.position ? 'hold' : 'skip',
      symbol,
      strategy: 'risk_management',
      budgetJpy: null,
      limitPrice: null,
      sellPositionPct: null,
      confidence: 0.5,
      expectedHoldingDays: null,
      stopLossPct: null,
      reason: context.position ? '保有継続条件を満たす' : '条件未達のため見送り',
      doNotBuyReasons: context.candidate?.doNotBuyReasons.length
        ? context.candidate.doNotBuyReasons
        : ['条件未達のため新規買いは見送り'],
      thesis: '',
      riskFactors: [],
      invalidationConditions: [],
    };
    return agentTradingDecisionSchema.parse(hold);
  }

  private evaluateBuy(
    candidate: Candidate,
    context: AgentTaskContext,
  ): AgentTradingDecision | null {
    if (candidate.score < this.minScoreToBuy) return null;
    // advanced filters can hard-block the buy (quality / gap / follow-through / regime)
    if (candidate.buyAllowed === false) return null;
    const confidence = clamp01(candidate.score / 100);
    if (confidence < context.riskRules.minConfidenceToTrade) return null;
    if (context.account.buyingPowerJpy <= 0) return null;
    const maxExposureJpy =
      (context.account.equityJpy * context.riskRules.maxTotalExposurePct) / 100;
    if (context.account.totalExposureJpy >= maxExposureJpy) return null;

    // MarketRegimeFilter position sizing (0.5x in neutral, 0 in risk_off->blocked above)
    const regimeMult = candidate.advancedFilters?.marketRegime?.positionSizeMultiplier ?? 1;
    if (regimeMult <= 0) return null;

    const maxSingleJpy =
      (context.account.equityJpy * context.riskRules.maxSinglePositionPct) / 100;
    const budgetJpy = Math.floor(
      Math.min(maxSingleJpy * regimeMult, context.account.buyingPowerJpy),
    );
    if (budgetJpy < candidate.close) return null;

    // buy decisions still surface considered risks (>=1 required)
    const doNotBuyReasons =
      candidate.doNotBuyReasons.length > 0
        ? candidate.doNotBuyReasons
        : ['地合い変化で前提が崩れる可能性', '決算後の出尽くしリスク'];

    return {
      decision: 'buy',
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      budgetJpy,
      limitPrice: Math.round(candidate.close),
      sellPositionPct: null,
      confidence,
      expectedHoldingDays: 20,
      stopLossPct: context.riskRules.stopLossPct,
      reason: `${candidate.strategy} スコア${candidate.score.toFixed(0)} (${candidate.reasons.slice(0, 3).join(', ')})`,
      doNotBuyReasons,
      thesis: `${candidate.name} は ${candidate.strategy} の条件を満たし、出来高${candidate.volumeRatio20d.toFixed(1)}x・52週高値まで${candidate.distanceTo52wHighPct.toFixed(1)}%。`,
      riskFactors: ['地合い悪化', '決算後の出尽くし', '流動性低下'],
      invalidationConditions: [
        `平均取得単価から-${context.riskRules.stopLossPct}%`,
        '25日移動平均線割れ',
        '出来高を伴った急落',
        '決算翌日安値割れ',
      ],
    };
  }

  private skip(candidate: Candidate, context: AgentTaskContext): AgentTradingDecision {
    const reasons =
      candidate.doNotBuyReasons.length > 0
        ? candidate.doNotBuyReasons
        : [`スコア${candidate.score.toFixed(0)} < ${this.minScoreToBuy}`];
    void context;
    return {
      decision: 'skip',
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      budgetJpy: null,
      limitPrice: null,
      sellPositionPct: null,
      confidence: clamp01(candidate.score / 100),
      expectedHoldingDays: null,
      stopLossPct: null,
      reason: `見送り: ${reasons[0]}`,
      doNotBuyReasons: reasons,
      thesis: '',
      riskFactors: [],
      invalidationConditions: [],
    };
  }

  private evaluateSell(
    pos: AgentPositionView,
    context: AgentTaskContext,
  ): AgentTradingDecision | null {
    const r = context.riskRules;
    // Mechanical take-profit partials are enforced once by the risk engine; the
    // agent emits only full-exit decisions (stop-loss, trailing-stop) which the
    // broker treats idempotently (a no-op if the position is already closed).
    // stop loss
    if (pos.stopLossPrice !== null && pos.currentPrice <= pos.stopLossPrice) {
      return this.sell(pos, 100, `stop_loss: 現値${pos.currentPrice} <= 損切り${pos.stopLossPrice}`);
    }
    // trailing stop
    if (pos.highestPriceSinceEntry !== null) {
      const trail = pos.highestPriceSinceEntry * (1 - r.trailingStopPct / 100);
      if (pos.highestPriceSinceEntry > pos.avgPrice && pos.currentPrice <= trail) {
        return this.sell(pos, 100, `trailing_stop: 高値${pos.highestPriceSinceEntry}から-${r.trailingStopPct}%`);
      }
    }
    return null;
  }

  private sell(pos: AgentPositionView, pct: number, reason: string): AgentTradingDecision {
    return {
      decision: 'sell',
      symbol: pos.symbol,
      strategy: 'risk_management',
      budgetJpy: null,
      limitPrice: null,
      sellPositionPct: pct,
      confidence: 0.9,
      expectedHoldingDays: null,
      stopLossPct: null,
      reason,
      doNotBuyReasons: ['売り判断（新規買いではない）'],
      thesis: `${pos.symbol} のエグジット条件に到達`,
      riskFactors: [],
      invalidationConditions: [],
    };
  }

  async reviewBacktest(summary: BacktestSummaryForAI): Promise<EvolutionProposalJson> {
    const configChanges: EvolutionProposalJson['configChanges'] = [];

    if (summary.maxDrawdownPct > 20) {
      configChanges.push({
        path: 'risk.stopLossPct',
        from: 8,
        to: 7,
        rationale: `最大DD ${summary.maxDrawdownPct.toFixed(1)}% が大きいため損切りを早める`,
      });
      configChanges.push({
        path: 'risk.trailingStopPct',
        from: 12,
        to: 10,
        rationale: 'トレーリングを引き締めて利益を守る',
      });
    }
    if (summary.winRatePct < 45) {
      configChanges.push({
        path: 'scoring.minVolumeRatioForBreakout',
        from: 1.5,
        to: 1.8,
        rationale: `勝率 ${summary.winRatePct.toFixed(0)}% が低いため出来高条件を厳格化`,
      });
      configChanges.push({
        path: 'scoring.minEarningsMomentumScore',
        from: 60,
        to: 68,
        rationale: '候補の質を上げて勝率改善を狙う',
      });
    }
    if (summary.profitFactor < 1.3) {
      configChanges.push({
        path: 'risk.minConfidenceToTrade',
        from: 0.6,
        to: 0.68,
        rationale: `PF ${summary.profitFactor.toFixed(2)} が低いため低確信トレードを抑制`,
      });
    }
    // loss-type driven advanced-filter adjustments (the kenmo evolution rules)
    for (const change of proposeFromLossStats(summary.lossTypeStats ?? [], DEFAULT_STRATEGY_CONFIG)) {
      configChanges.push(change);
    }

    if (configChanges.length === 0) {
      configChanges.push({
        path: 'risk.takeProfitSellPct',
        from: 25,
        to: 33,
        rationale: '結果は良好。利確比率を上げて利益確定を厚くする微調整',
      });
    }

    const topLoss = (summary.lossTypeStats ?? [])[0];
    const proposal: EvolutionProposalJson = {
      reason: topLoss
        ? `最大の負け要因 ${topLoss.lossType}（${topLoss.tradeCount}件）に基づくkenmo式改善`
        : '直近バックテスト結果に基づくkenmo式パラメータ改善',
      summary: `総リターン${(summary.totalReturnPct ?? 0).toFixed(1)}% / 最大DD${(summary.maxDrawdownPct ?? 0).toFixed(1)}% / 勝率${(summary.winRatePct ?? 0).toFixed(0)}% / PF${(summary.profitFactor ?? 0).toFixed(2)}`,
      bestPatterns: summary.bestPatterns,
      worstPatterns: summary.worstPatterns,
      configChanges,
      promptNotes: '引け前の新規買いを抑制し、決算後のギャップアップ追い買いを制限する方針を強化',
    };
    return evolutionProposalSchema.parse(proposal);
  }

  async proposeChallenger(input: ChallengerProposalInput): Promise<ChallengerProposalResult> {
    const review = await this.reviewBacktest(input.summary);
    const result: ChallengerProposalResult = {
      challengerName: `${input.championName}-challenger`,
      reason: review.reason,
      configChanges: review.configChanges,
      promptVersion: 'kenmo-v1',
    };
    return challengerProposalResultSchema.parse(result);
  }
}
