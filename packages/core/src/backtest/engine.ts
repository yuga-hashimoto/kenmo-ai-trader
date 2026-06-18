import type {
  AgentTaskContext,
  AgentTaskResult,
  AgentTradingDecision,
} from '../types/agent.js';
import type {
  AgentTaskType,
  BacktestSummary,
  DailyBar,
  OrderSide,
  OrderStatus,
  StrategyConfig,
} from '../types/index.js';
import type { MarketDataProvider } from '../market/MarketDataProvider.js';
import { VirtualClock, tradingDatesInRange } from './virtualClock.js';
import { generateScheduleForDates, SINGLE_DAILY_SESSION, toJstIso } from '../scheduler/schedule.js';
import {
  applyBuyFill,
  applySellFill,
  computeSnapshot,
  createPortfolio,
  markPartialTpDone,
  updateHighs,
  type ClosedTrade,
  type PortfolioSnapshot,
  type PortfolioState,
} from '../portfolio/accounting.js';
import { checkOrder } from '../risk/riskEngine.js';
import {
  participationCap,
  simulateExitAtClose,
  simulateLimitBuy,
  simulateLimitSell,
  simulateStopLossSell,
} from './fill.js';
import { isLimitDownLocked, isLimitUpLocked } from '../market/priceLimits.js';
import { sma25 } from '../strategy/indicators.js';
import { computeBacktestSummary } from './metrics.js';
import { classifyOutcome, type EntryFeatureBlob, type OutcomeLabels } from '../strategy/lossType.js';
import type { Candidate } from '../strategy/candidates.js';
import type { LossType } from '../types/index.js';

/** Minimal structural port over HermesAgentClient (avoids core->hermes dependency). */
export interface AgentPort {
  runTradingTask(ctx: AgentTaskContext): Promise<AgentTaskResult>;
}

export interface EngineOrderRecord {
  id: string;
  symbolCode: string;
  side: OrderSide;
  orderType: 'limit' | 'marketable_limit';
  requestedBudgetJpy: number | null;
  requestedQuantity: number | null;
  finalQuantity: number | null;
  limitPrice: number | null;
  status: OrderStatus;
  reason: string;
  rejectionReason: string | null;
  doNotBuyReasons: string[];
  strategy: string;
  confidence: number;
  createdAt: string;
  agentRunId: string | null;
  schedulerEventId: string | null;
}

export interface EngineExecutionRecord {
  id: string;
  orderId: string;
  symbolCode: string;
  side: OrderSide;
  quantity: number;
  executionPrice: number;
  commissionJpy: number;
  slippageJpy: number;
  executedAt: string;
}

export interface EngineAgentRunRecord {
  id: string;
  agentRole: string;
  taskType: AgentTaskType;
  modelName: string;
  promptVersion: string;
  inputJson: AgentTaskContext;
  outputJson: AgentTaskResult;
  inputHash: string;
  outputValid: boolean;
  createdAt: string;
}

export interface EngineSchedulerEventRecord {
  id: string;
  eventDate: string;
  virtualTime: string;
  eventType: AgentTaskType;
  status: 'completed' | 'failed';
  agentRunId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface EngineTradeEpisode extends ClosedTrade {
  thesis: string | null;
  invalidationConditions: string[];
  featuresAtEntry: Record<string, unknown>;
  maxFavorableExcursionPct: number | null;
  maxAdverseExcursionPct: number | null;
  lossType: LossType | null;
  outcomeLabels: OutcomeLabels;
}

export interface BacktestResult {
  summary: BacktestSummary;
  orders: EngineOrderRecord[];
  executions: EngineExecutionRecord[];
  snapshots: PortfolioSnapshot[];
  agentRuns: EngineAgentRunRecord[];
  schedulerEvents: EngineSchedulerEventRecord[];
  tradeEpisodes: EngineTradeEpisode[];
  closedTrades: ClosedTrade[];
  openPositions: import('../portfolio/accounting.js').HeldPosition[];
}

export interface BacktestEngineParams {
  provider: MarketDataProvider;
  agent: AgentPort;
  config: StrategyConfig;
  initialCapitalJpy: number;
  allowMargin: boolean;
  startDate: string;
  endDate: string;
  modelName?: string;
  promptVersion?: string;
  /**
   * Resume from an existing portfolio (live daily stepping) instead of starting
   * flat. When set, the run continues cash/positions/peak-equity from this state
   * so drawdown and holding periods stay continuous across real trading days.
   */
  initialPortfolio?: import('../portfolio/accounting.js').PortfolioState;
  /**
   * Realistic timing: make decisions using data only up to the PRIOR trading day
   * (candidates + valuations as-of T-1) while still executing on day T's bar
   * (buys at T's open). Removes the look-ahead of deciding on T's close and
   * filling at T's open — matches an "analyze after close, trade next open" loop.
   */
  decideAsOfPriorTradingDay?: boolean;
  /**
   * Run a single monitor_and_trade session per day instead of the full 8-event
   * intraday schedule. With daily bars the 8 sessions see identical data and
   * yield the same de-duplicated decisions, so one call/day is equivalent at 1/8
   * the AI cost. Used by the live loop.
   */
  singleDailySession?: boolean;
  /**
   * Treat take-profit and trailing-stop as standing orders that trigger on the
   * day's intraday extremes (high/low), like stop-loss already does — the
   * daily-bar equivalent of monitoring exits continuously through the session.
   * Needs no AI. Without this they only check the close and miss intraday moves.
   */
  intradayRiskExits?: boolean;
  /**
   * Capital-aware operation: only show the AI candidates it can actually afford
   * (price × lot ≤ buying power), and skip the AI call entirely on days where
   * nothing is affordable AND there are no open positions (nothing to do).
   * Avoids wasting a call when capital is ~0 and proposing un-buyable names.
   */
  capitalAwareCandidates?: boolean;
}

let __seq = 0;
const id = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(__seq++).toString(36)}`;

function simpleHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return (h >>> 0).toString(16);
}

const BUY_ALLOWED: AgentTaskType[] = ['monitor_and_trade'];
const SELL_ALLOWED: AgentTaskType[] = [
  'monitor_and_trade',
  'pre_lunch_review',
  'pre_close_review',
];

/**
 * Runs a complete event-driven backtest in memory and returns every record the
 * persistence layer needs. No DB, no network — fully unit-testable.
 */
export class BacktestEngine {
  constructor(private readonly params: BacktestEngineParams) {}

  async run(): Promise<BacktestResult> {
    const { provider, agent, config, initialCapitalJpy, allowMargin } = this.params;
    const modelName = this.params.modelName ?? 'mock-hermes';
    const promptVersion = this.params.promptVersion ?? 'kenmo-v1';

    const allDates = await provider.getTradingDates();
    const dates = tradingDatesInRange(allDates, this.params.startDate, this.params.endDate);
    const clock = new VirtualClock(dates);
    // Map each trading day to the one before it (across ALL history, not just the
    // run window) so realistic-timing runs can decide as-of the prior session.
    const priorTradingDate = new Map<string, string>();
    for (let i = 1; i < allDates.length; i++) priorTradingDate.set(allDates[i]!, allDates[i - 1]!);
    const decisionDateFor = (d: string): string =>
      this.params.decideAsOfPriorTradingDay ? (priorTradingDate.get(d) ?? d) : d;
    const symbols = await provider.getSymbols();
    const symbolName = new Map(symbols.map((s) => [s.code, s.name]));
    const lotByCode = new Map(symbols.map((s) => [s.code, s.lotSize]));

    let portfolio: PortfolioState = this.params.initialPortfolio ?? createPortfolio(initialCapitalJpy);

    const orders: EngineOrderRecord[] = [];
    const executions: EngineExecutionRecord[] = [];
    const snapshots: PortfolioSnapshot[] = [];
    const agentRuns: EngineAgentRunRecord[] = [];
    const schedulerEvents: EngineSchedulerEventRecord[] = [];
    const closedTrades: ClosedTrade[] = [];
    // entry feature snapshots keyed by symbol for trade-episode enrichment
    const entryFeatures = new Map<string, Record<string, unknown>>();
    // previous trading day's closes, used for ストップ高/安 (price-limit) checks
    let prevCloseMap = new Map<string, number>();

    const scheduleByDate = new Map<string, ReturnType<typeof generateScheduleForDates>>();
    const daySchedule = this.params.singleDailySession ? SINGLE_DAILY_SESSION : undefined;
    for (const plan of generateScheduleForDates(dates, daySchedule)) {
      const arr = scheduleByDate.get(plan.eventDate) ?? [];
      arr.push(plan);
      scheduleByDate.set(plan.eventDate, arr);
    }

    while (clock.next()) {
      const date = clock.currentDate;
      const dayBars = new Map<string, DailyBar>();
      for (const s of symbols) {
        const bar = await provider.getDailyPrice(s.code, date);
        if (bar) dayBars.set(s.code, bar);
      }
      // Decisions/valuations are as-of the decision day (T-1 in realistic mode),
      // while dayBars/fills below stay on the execution day (T).
      const decisionDate = decisionDateFor(date);
      const priceMap = await this.buildPriceMap(symbols.map((s) => s.code), decisionDate);

      let ordersToday = 0;
      const pendingBuys: Array<{ order: EngineOrderRecord; decision: AgentTradingDecision }> = [];
      const aiSells: Array<{ symbol: string; pct: number; reason: string }> = [];
      // a position is only registered at day-end, so guard against buying the
      // same symbol multiple times across the day's monitor events
      const pendingBuySymbols = new Set<string>();
      // candidates seen this day, keyed by symbol, for entry-feature enrichment
      const dayCandidates = new Map<string, Candidate>();

      for (const plan of scheduleByDate.get(date) ?? []) {
        let candidates = await provider.getCandidates(decisionDate, config);
        if (this.params.capitalAwareCandidates) {
          const bp = this.buyingPowerOf(portfolio, priceMap, allowMargin, config);
          // Keep only names whose minimum lot is affordable with current buying power.
          candidates = candidates.filter(
            (c) => c.close * (lotByCode.get(c.symbol) ?? 100) <= bp,
          );
          // Broke and flat -> no buy possible and nothing to manage; skip the AI call.
          if (candidates.length === 0 && portfolio.positions.length === 0) continue;
        }
        for (const c of candidates) dayCandidates.set(c.symbol, c);
        const ctx = this.buildContext(
          portfolio,
          priceMap,
          candidates,
          symbolName,
          plan.eventType,
          toJstIso(date, plan.virtualTime),
          allowMargin,
          config,
        );

        let result: AgentTaskResult;
        let outputValid = true;
        let errorMessage: string | null = null;
        try {
          result = await agent.runTradingTask(ctx);
        } catch (err) {
          outputValid = false;
          errorMessage = err instanceof Error ? err.message : String(err);
          result = { taskType: plan.eventType, decisions: [], watchlistSymbols: [], notes: errorMessage };
        }

        const agentRunId = id('ar');
        agentRuns.push({
          id: agentRunId,
          agentRole: this.roleForTask(plan.eventType),
          taskType: plan.eventType,
          modelName,
          promptVersion,
          inputJson: ctx,
          outputJson: result,
          inputHash: simpleHash(JSON.stringify(ctx)),
          outputValid,
          createdAt: toJstIso(date, plan.virtualTime),
        });
        const eventId = id('se');
        schedulerEvents.push({
          id: eventId,
          eventDate: date,
          virtualTime: plan.virtualTime,
          eventType: plan.eventType,
          status: outputValid ? 'completed' : 'failed',
          agentRunId,
          errorMessage,
          createdAt: toJstIso(date, plan.virtualTime),
        });

        // enact decisions
        for (const decision of result.decisions) {
          if (decision.decision === 'buy' && BUY_ALLOWED.includes(plan.eventType)) {
            if (pendingBuySymbols.has(decision.symbol)) continue;
            const enacted = this.enactBuy(
              decision,
              portfolio,
              priceMap,
              allowMargin,
              config,
              lotByCode.get(decision.symbol) ?? 100,
              ordersToday,
              date,
              agentRunId,
              eventId,
            );
            orders.push(enacted.order);
            if (enacted.order.status === 'pending') {
              ordersToday += 1;
              pendingBuySymbols.add(decision.symbol);
              pendingBuys.push({ order: enacted.order, decision });
            }
          } else if (decision.decision === 'sell' && SELL_ALLOWED.includes(plan.eventType)) {
            aiSells.push({
              symbol: decision.symbol,
              pct: decision.sellPositionPct ?? 100,
              reason: decision.reason,
            });
          }
        }
      }

      // ---- day end processing: exits first, then buy fills ----
      portfolio = this.processRiskExits(portfolio, dayBars, prevCloseMap, date, config, orders, executions, closedTrades, entryFeatures);
      portfolio = this.processAiSells(portfolio, dayBars, prevCloseMap, date, config, aiSells, orders, executions, closedTrades, entryFeatures);
      portfolio = this.processBuyFills(portfolio, dayBars, prevCloseMap, date, config, pendingBuys, executions, entryFeatures, dayCandidates);

      // Trail off the intraday high when monitoring exits intraday, else the close.
      portfolio = updateHighs(
        portfolio,
        this.params.intradayRiskExits ? this.highMap(dayBars) : this.closeMap(dayBars),
      );
      const { snapshot, peakEquityJpy } = computeSnapshot(portfolio, date, this.closeMap(dayBars));
      portfolio = { ...portfolio, peakEquityJpy };
      snapshots.push(snapshot);
      prevCloseMap = this.closeMap(dayBars);
    }

    const summary = computeBacktestSummary({
      initialCapitalJpy,
      startDate: this.params.startDate,
      endDate: this.params.endDate,
      snapshots,
      closedTrades,
    });

    const tradeEpisodes: EngineTradeEpisode[] = closedTrades.map((t) => {
      const features = entryFeatures.get(`${t.symbolCode}:${t.entryDate}`) ?? {};
      const featureBlob: EntryFeatureBlob = {
        earningsQuality: features.earningsQuality as EntryFeatureBlob['earningsQuality'],
        gapOverheat: features.gapOverheat as EntryFeatureBlob['gapOverheat'],
        followThrough: features.followThrough as EntryFeatureBlob['followThrough'],
        marketRegime: features.marketRegime as EntryFeatureBlob['marketRegime'],
        relativeStrength: features.relativeStrength as EntryFeatureBlob['relativeStrength'],
      };
      const outcomeLabels = config.advancedFilters.lossTypeClassification.enabled
        ? classifyOutcome({ pnlJpy: t.pnlJpy, exitReason: t.exitReason, features: featureBlob })
        : { outcome: (t.pnlJpy >= 0 ? 'win' : 'loss') as 'win' | 'loss', lossType: null };
      return {
        ...t,
        thesis: (features.thesis as string | undefined) ?? null,
        invalidationConditions: (features.invalidationConditions as string[] | undefined) ?? [],
        featuresAtEntry: features,
        maxFavorableExcursionPct: null,
        maxAdverseExcursionPct: null,
        lossType: outcomeLabels.lossType,
        outcomeLabels,
      };
    });

    return {
      summary,
      orders,
      executions,
      snapshots,
      agentRuns,
      schedulerEvents,
      tradeEpisodes,
      closedTrades,
      openPositions: portfolio.positions,
    };
  }

  private roleForTask(task: AgentTaskType): string {
    if (task === 'review_backtest' || task === 'propose_challenger') return 'kenmo-evolution';
    if (task === 'prepare_watchlist' || task === 'after_close_analysis') return 'kenmo-researcher';
    return 'kenmo-trader';
  }

  private async buildPriceMap(codes: string[], date: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const code of codes) {
      const bar = await this.params.provider.getLatestPrice(code, date);
      if (bar) map.set(code, bar.close);
    }
    return map;
  }

  private closeMap(dayBars: Map<string, DailyBar>): Map<string, number> {
    const m = new Map<string, number>();
    for (const [code, bar] of dayBars) m.set(code, bar.close);
    return m;
  }

  private highMap(dayBars: Map<string, DailyBar>): Map<string, number> {
    const m = new Map<string, number>();
    for (const [code, bar] of dayBars) m.set(code, bar.high);
    return m;
  }

  /** Buying power as-of the decision prices: cash (cash account) or leverage-bounded. */
  private buyingPowerOf(
    portfolio: PortfolioState,
    priceMap: Map<string, number>,
    allowMargin: boolean,
    config: StrategyConfig,
  ): number {
    if (!allowMargin) return portfolio.cashJpy;
    const { snapshot } = computeSnapshot(portfolio, '1970-01-01', priceMap);
    return snapshot.equityJpy * config.risk.maxLeverageIfMarginEnabled - snapshot.marketValueJpy;
  }

  private buildContext(
    portfolio: PortfolioState,
    priceMap: Map<string, number>,
    candidates: Awaited<ReturnType<MarketDataProvider['getCandidates']>>,
    symbolName: Map<string, string>,
    taskType: AgentTaskType,
    backtestTime: string,
    allowMargin: boolean,
    config: StrategyConfig,
  ): AgentTaskContext {
    const { snapshot } = computeSnapshot(portfolio, backtestTime.slice(0, 10), priceMap);
    const equity = snapshot.equityJpy;
    const exposure = snapshot.marketValueJpy;
    const buyingPower = allowMargin
      ? equity * config.risk.maxLeverageIfMarginEnabled - exposure
      : portfolio.cashJpy;

    return {
      backtestTime,
      mode: 'backtest',
      taskType,
      account: {
        initialCapitalJpy: portfolio.initialCapitalJpy,
        cashJpy: portfolio.cashJpy,
        equityJpy: equity,
        buyingPowerJpy: buyingPower,
        allowMargin,
        totalExposureJpy: exposure,
        totalReturnPct: snapshot.totalReturnPct,
        maxDrawdownPct: snapshot.drawdownPct,
      },
      riskRules: {
        maxSinglePositionPct: config.risk.maxSinglePositionPct,
        maxTotalExposurePct: config.risk.maxTotalExposurePct,
        stopLossPct: config.risk.stopLossPct,
        takeProfitPct: config.risk.takeProfitPct,
        trailingStopPct: config.risk.trailingStopPct,
        allowNampin: config.risk.allowNampin,
        allowMarketBuy: config.risk.allowMarketBuy,
        minConfidenceToTrade: config.risk.minConfidenceToTrade,
      },
      positions: portfolio.positions.map((p) => {
        const current = priceMap.get(p.symbolCode) ?? p.avgPrice;
        return {
          symbol: p.symbolCode,
          name: symbolName.get(p.symbolCode) ?? p.symbolCode,
          quantity: p.quantity,
          avgPrice: p.avgPrice,
          currentPrice: current,
          unrealizedPnlJpy: (current - p.avgPrice) * p.quantity,
          unrealizedPnlPct: p.avgPrice > 0 ? ((current - p.avgPrice) / p.avgPrice) * 100 : 0,
          entryReason: p.entryReason,
          strategy: p.strategy,
          stopLossPrice: p.stopLossPrice,
          highestPriceSinceEntry: p.highestPriceSinceEntry,
        };
      }),
      candidates,
      marketRegime: this.regimeView(candidates),
    };
  }

  /** Map the (market-wide) MarketRegimeFeature on candidates to the AgentContext view. */
  private regimeView(
    candidates: Awaited<ReturnType<MarketDataProvider['getCandidates']>>,
  ): AgentTaskContext['marketRegime'] {
    const mr = candidates.find((c) => c.advancedFilters?.marketRegime)?.advancedFilters?.marketRegime;
    if (!mr) return { indexTrend: 'unknown', riskOn: true, comment: 'regime data unavailable' };
    const indexTrend = mr.regime === 'risk_on' ? 'up' : mr.regime === 'risk_off' ? 'down' : 'sideways';
    return {
      indexTrend,
      riskOn: mr.regime !== 'risk_off',
      comment: `${mr.indexCode} close=${mr.close} ma25=${Math.round(mr.ma25)} ma75=${Math.round(mr.ma75)} (${mr.regime})`,
    };
  }

  private enactBuy(
    decision: AgentTradingDecision,
    portfolio: PortfolioState,
    priceMap: Map<string, number>,
    allowMargin: boolean,
    config: StrategyConfig,
    lotSize: number,
    ordersToday: number,
    date: string,
    agentRunId: string,
    eventId: string,
  ): { order: EngineOrderRecord } {
    const refPrice = decision.limitPrice ?? priceMap.get(decision.symbol) ?? 0;
    const { snapshot } = computeSnapshot(portfolio, date, priceMap);
    const account = {
      runId: 'engine',
      initialCapitalJpy: portfolio.initialCapitalJpy,
      cashJpy: portfolio.cashJpy,
      marketValueJpy: snapshot.marketValueJpy,
      equityJpy: snapshot.equityJpy,
      buyingPowerJpy: allowMargin
        ? snapshot.equityJpy * config.risk.maxLeverageIfMarginEnabled - snapshot.marketValueJpy
        : portfolio.cashJpy,
      allowMargin,
      totalExposureJpy: snapshot.marketValueJpy,
      totalReturnPct: snapshot.totalReturnPct,
      maxDrawdownPct: snapshot.drawdownPct,
    };
    const positions = portfolio.positions.map((p) => ({
      symbolCode: p.symbolCode,
      quantity: p.quantity,
      avgPrice: p.avgPrice,
      currentPrice: priceMap.get(p.symbolCode) ?? p.avgPrice,
      unrealizedPnlJpy: 0,
      unrealizedPnlPct: 0,
      entryReason: p.entryReason,
      strategy: p.strategy,
      stopLossPrice: p.stopLossPrice,
      highestPriceSinceEntry: p.highestPriceSinceEntry,
    }));

    const check = checkOrder(
      {
        runType: 'backtest',
        runId: 'engine',
        symbolCode: decision.symbol,
        side: 'buy',
        orderType: config.risk.allowMarketBuy ? 'marketable_limit' : 'limit',
        requestedBudgetJpy: decision.budgetJpy,
        limitPrice: decision.limitPrice,
        reason: decision.reason,
        strategy: decision.strategy,
        confidence: decision.confidence,
        stopLossPct: decision.stopLossPct,
        atDate: date,
      },
      { account, positions, risk: config.risk, lotSize, ordersPlacedToday: ordersToday, referencePrice: refPrice },
    );

    const order: EngineOrderRecord = {
      id: id('ord'),
      symbolCode: decision.symbol,
      side: 'buy',
      orderType: 'limit',
      requestedBudgetJpy: decision.budgetJpy,
      requestedQuantity: null,
      finalQuantity: check.ok ? check.quantity : null,
      limitPrice: decision.limitPrice,
      status: check.ok ? 'pending' : 'rejected',
      reason: decision.reason,
      rejectionReason: check.rejectionReason,
      doNotBuyReasons: decision.doNotBuyReasons,
      strategy: decision.strategy,
      confidence: decision.confidence,
      createdAt: date,
      agentRunId,
      schedulerEventId: eventId,
    };
    return { order };
  }

  private processBuyFills(
    portfolio: PortfolioState,
    dayBars: Map<string, DailyBar>,
    prevCloseMap: Map<string, number>,
    date: string,
    config: StrategyConfig,
    pendingBuys: Array<{ order: EngineOrderRecord; decision: AgentTradingDecision }>,
    executions: EngineExecutionRecord[],
    entryFeatures: Map<string, Record<string, unknown>>,
    dayCandidates: Map<string, Candidate>,
  ): PortfolioState {
    let state = portfolio;
    for (const { order, decision } of pendingBuys) {
      const bar = dayBars.get(order.symbolCode);
      const limit = order.limitPrice ?? 0;
      let qty = order.finalQuantity ?? 0;
      if (!bar || qty <= 0 || limit <= 0) {
        order.status = 'cancelled';
        continue;
      }
      // ストップ高張り付き: 買いは約定不可
      const prevClose = prevCloseMap.get(order.symbolCode);
      if (prevClose !== undefined && isLimitUpLocked(bar, prevClose)) {
        order.status = 'cancelled';
        order.rejectionReason = 'limit-up locked (張り付き)';
        continue;
      }
      // 板/流動性: 当日出来高の一定割合までしか約定しない
      qty = participationCap(qty, bar.volume, 0.1);
      if (qty <= 0) {
        order.status = 'cancelled';
        order.rejectionReason = 'insufficient liquidity';
        continue;
      }
      const fill = simulateLimitBuy(bar, limit, qty, config.risk);
      if (!fill.filled) {
        order.status = 'cancelled'; // limit not reached -> unfilled
        continue;
      }
      order.finalQuantity = qty;
      const stopLossPrice =
        fill.executionPrice * (1 - (decision.stopLossPct ?? config.risk.stopLossPct) / 100);
      state = applyBuyFill(state, {
        symbolCode: order.symbolCode,
        quantity: qty,
        executionPrice: fill.executionPrice,
        commissionJpy: fill.commissionJpy,
        strategy: decision.strategy,
        entryReason: decision.reason,
        date,
        stopLossPrice,
      });
      order.status = 'filled';
      executions.push({
        id: id('exe'),
        orderId: order.id,
        symbolCode: order.symbolCode,
        side: 'buy',
        quantity: qty,
        executionPrice: fill.executionPrice,
        commissionJpy: fill.commissionJpy,
        slippageJpy: fill.slippageJpy,
        executedAt: date,
      });
      const cand = dayCandidates.get(order.symbolCode);
      const af = cand?.advancedFilters ?? null;
      entryFeatures.set(`${order.symbolCode}:${date}`, {
        limitPrice: limit,
        fillPrice: fill.executionPrice,
        strategy: decision.strategy,
        confidence: decision.confidence,
        thesis: decision.thesis,
        invalidationConditions: decision.invalidationConditions,
        doNotBuyReasons: decision.doNotBuyReasons,
        baseScore: cand?.baseScore ?? null,
        score: cand?.score ?? null,
        earningsQuality: af?.earningsQuality ?? null,
        gapOverheat: af?.gapOverheat ?? null,
        followThrough: af?.followThrough ?? null,
        marketRegime: af?.marketRegime ?? null,
        relativeStrength: af?.relativeStrength ?? null,
      });
    }
    return state;
  }

  private processRiskExits(
    portfolio: PortfolioState,
    dayBars: Map<string, DailyBar>,
    prevCloseMap: Map<string, number>,
    date: string,
    config: StrategyConfig,
    orders: EngineOrderRecord[],
    executions: EngineExecutionRecord[],
    closedTrades: ClosedTrade[],
    entryFeatures: Map<string, Record<string, unknown>>,
  ): PortfolioState {
    void entryFeatures;
    let state = portfolio;
    for (const pos of [...state.positions]) {
      const bar = dayBars.get(pos.symbolCode);
      if (!bar) continue;

      // ストップ安張り付き: 売れないので当日のエグジットは全てスキップ（翌日へ持ち越し）
      const prevClose = prevCloseMap.get(pos.symbolCode);
      if (prevClose !== undefined && isLimitDownLocked(bar, prevClose)) continue;

      // 1) stop-loss (gap-down -> open)
      const stop = pos.stopLossPrice;
      if (stop !== null && bar.low <= stop) {
        const fill = simulateStopLossSell(bar, stop, pos.quantity, config.risk);
        state = this.recordSell(state, pos.symbolCode, pos.quantity, fill.executionPrice, fill.commissionJpy, fill.slippageJpy, date, 'stop_loss -8%', 'risk_management', orders, executions, closedTrades);
        continue;
      }

      const close = bar.close;
      const intraday = this.params.intradayRiskExits === true;
      // 2) take-profit (+takeProfitPct -> sell takeProfitSellPct%), fires once.
      // intraday: a resting limit-sell that triggers if the day's HIGH reaches
      // the target; otherwise only the close is checked.
      const tpPrice = pos.avgPrice * (1 + config.risk.takeProfitPct / 100);
      const tpHit = intraday ? bar.high >= tpPrice : close >= tpPrice;
      if (tpHit && !pos.partialTpDone) {
        const sellQty = Math.max(1, Math.floor((pos.quantity * config.risk.takeProfitSellPct) / 100));
        const fill = intraday
          ? simulateLimitSell(bar, tpPrice, sellQty, config.risk)
          : simulateExitAtClose(bar, sellQty, config.risk);
        if (fill.filled) {
          state = this.recordSell(state, pos.symbolCode, sellQty, fill.executionPrice, fill.commissionJpy, fill.slippageJpy, date, `take_profit +${config.risk.takeProfitPct}%`, 'risk_management', orders, executions, closedTrades);
          state = markPartialTpDone(state, pos.symbolCode);
          continue;
        }
      }

      // 3) trailing stop (from high). intraday: a resting stop that triggers if
      // the day's LOW breaches the trail; otherwise only the close is checked.
      const trailPrice = pos.highestPriceSinceEntry * (1 - config.risk.trailingStopPct / 100);
      const trailHit = intraday ? bar.low <= trailPrice : close <= trailPrice;
      if (pos.highestPriceSinceEntry > pos.avgPrice && trailHit) {
        const fill = intraday
          ? simulateStopLossSell(bar, trailPrice, pos.quantity, config.risk)
          : simulateExitAtClose(bar, pos.quantity, config.risk);
        if (fill.filled) {
          state = this.recordSell(state, pos.symbolCode, pos.quantity, fill.executionPrice, fill.commissionJpy, fill.slippageJpy, date, `trailing_stop -${config.risk.trailingStopPct}%`, 'risk_management', orders, executions, closedTrades);
          continue;
        }
      }
    }
    return state;
  }

  private processAiSells(
    portfolio: PortfolioState,
    dayBars: Map<string, DailyBar>,
    prevCloseMap: Map<string, number>,
    date: string,
    config: StrategyConfig,
    aiSells: Array<{ symbol: string; pct: number; reason: string }>,
    orders: EngineOrderRecord[],
    executions: EngineExecutionRecord[],
    closedTrades: ClosedTrade[],
    entryFeatures: Map<string, Record<string, unknown>>,
  ): PortfolioState {
    void entryFeatures;
    let state = portfolio;
    for (const sell of aiSells) {
      const pos = state.positions.find((p) => p.symbolCode === sell.symbol);
      const bar = dayBars.get(sell.symbol);
      if (!pos || !bar) continue;
      const prevClose = prevCloseMap.get(sell.symbol);
      if (prevClose !== undefined && isLimitDownLocked(bar, prevClose)) continue;
      const qty = Math.max(1, Math.floor((pos.quantity * Math.min(100, Math.max(1, sell.pct))) / 100));
      const fill = simulateExitAtClose(bar, qty, config.risk);
      state = this.recordSell(state, sell.symbol, qty, fill.executionPrice, fill.commissionJpy, fill.slippageJpy, date, sell.reason || 'ai_sell', pos.strategy, orders, executions, closedTrades);
    }
    return state;
  }

  private recordSell(
    state: PortfolioState,
    symbol: string,
    quantity: number,
    price: number,
    commissionJpy: number,
    slippageJpy: number,
    date: string,
    exitReason: string,
    strategy: string,
    orders: EngineOrderRecord[],
    executions: EngineExecutionRecord[],
    closedTrades: ClosedTrade[],
  ): PortfolioState {
    const orderId = id('ord');
    orders.push({
      id: orderId,
      symbolCode: symbol,
      side: 'sell',
      orderType: 'limit',
      requestedBudgetJpy: null,
      requestedQuantity: quantity,
      finalQuantity: quantity,
      limitPrice: price,
      status: 'filled',
      reason: exitReason,
      rejectionReason: null,
      doNotBuyReasons: ['売り判断（新規買いではない）'],
      strategy,
      confidence: 1,
      createdAt: date,
      agentRunId: null,
      schedulerEventId: null,
    });
    const { state: next, closedTrade } = applySellFill(state, {
      symbolCode: symbol,
      quantity,
      executionPrice: price,
      commissionJpy,
      date,
      exitReason,
    });
    executions.push({
      id: id('exe'),
      orderId,
      symbolCode: symbol,
      side: 'sell',
      quantity,
      executionPrice: price,
      commissionJpy,
      slippageJpy,
      executedAt: date,
    });
    if (closedTrade) closedTrades.push(closedTrade);
    return next;
  }
}

export function maBreakExitCandidate(bars: DailyBar[]): boolean {
  const ma = sma25(bars);
  const last = bars[bars.length - 1];
  if (ma === null || !last) return false;
  return last.close < ma;
}
