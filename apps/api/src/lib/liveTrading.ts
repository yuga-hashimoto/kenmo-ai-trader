import { prisma } from '@kenmo/db';
import { BacktestEngine, type PortfolioState, type HeldPosition } from '@kenmo/core';
import { loadMarketDataProvider } from './marketData.js';
import { parseStrategyConfig } from './config.js';
import { getAgent } from './agent.js';
import { persistRunResult } from './persist.js';
import { audit } from '../modules/audit/index.js';

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export interface DailyStepResult {
  processed: boolean;
  date: string | null;
  reason?: string;
  ordersFilled?: number;
  closedTrades?: number;
  equityJpy?: number;
}

/**
 * Reconstruct the live PortfolioState for a paper run from its persisted rows:
 * open positions become HeldPositions, and cash / realized P&L / peak equity are
 * carried from the latest snapshot so drawdown stays continuous across days.
 */
async function reconstructPortfolio(
  paperRunId: string,
  initialCapitalJpy: number,
): Promise<PortfolioState> {
  const positions = await prisma.position.findMany({
    where: { paperRunId, status: 'open' },
  });
  const lastSnap = await prisma.portfolioSnapshot.findFirst({
    where: { paperRunId },
    orderBy: { snapshotDate: 'desc' },
  });
  const peak = await prisma.portfolioSnapshot.aggregate({
    where: { paperRunId },
    _max: { equityJpy: true },
  });

  const held: HeldPosition[] = positions.map((p) => ({
    symbolCode: p.symbolCode,
    quantity: p.quantity,
    avgPrice: p.avgPrice,
    strategy: p.strategy,
    entryReason: p.entryReason,
    entryDate: isoDay(p.openedAt),
    stopLossPrice: p.stopLossPrice,
    highestPriceSinceEntry: p.highestPriceSinceEntry ?? p.avgPrice,
    partialTpDone: false,
  }));

  return {
    initialCapitalJpy,
    cashJpy: lastSnap?.cashJpy ?? initialCapitalJpy,
    realizedPnlJpy: lastSnap?.realizedPnlJpy ?? 0,
    peakEquityJpy: peak._max.equityJpy ?? initialCapitalJpy,
    positions: held,
  };
}

/**
 * Pick the earliest trading date this run has not processed yet.
 *
 * A brand-new live run does NOT replay all history — it starts from a short
 * recent window (LIVE_BACKFILL_DAYS, default 5 trading days) and then walks
 * forward as new market data arrives. This keeps "go live" responsive instead
 * of grinding through years of bars.
 */
async function nextUnprocessedDate(paperRunId: string): Promise<string | null> {
  const provider = await loadMarketDataProvider();
  const dates = await provider.getTradingDates();
  if (dates.length === 0) return null;
  const lastSnap = await prisma.portfolioSnapshot.findFirst({
    where: { paperRunId },
    orderBy: { snapshotDate: 'desc' },
  });
  if (!lastSnap) {
    const backfill = Math.max(1, Number(process.env.LIVE_BACKFILL_DAYS ?? 5));
    return dates[Math.max(0, dates.length - backfill)]!;
  }
  const last = isoDay(lastSnap.snapshotDate);
  return dates.find((d) => d > last) ?? null;
}

/**
 * Advance one running paper run forward by a single real trading day: reconstruct
 * its portfolio, run that day's sessions against the configured AI agent, and
 * append the resulting orders / fills / positions / snapshot / trades. Idempotent
 * — a day already represented by a snapshot is skipped. No real broker is touched.
 */
export async function runDailyStep(paperRunId: string): Promise<DailyStepResult> {
  const run = await prisma.paperRun.findUnique({ where: { id: paperRunId } });
  if (!run) return { processed: false, date: null, reason: 'run not found' };
  if (run.status !== 'running') return { processed: false, date: null, reason: `status=${run.status}` };

  const strategy = await prisma.strategyVersion.findUnique({ where: { id: run.strategyVersionId } });
  if (!strategy) return { processed: false, date: null, reason: 'strategy not found' };

  const date = await nextUnprocessedDate(paperRunId);
  if (!date) return { processed: false, date: null, reason: 'no new market data' };

  const provider = await loadMarketDataProvider();
  const initialPortfolio = await reconstructPortfolio(paperRunId, run.initialCapitalJpy);

  const engine = new BacktestEngine({
    provider,
    agent: getAgent(),
    config: parseStrategyConfig(strategy.configJson),
    initialCapitalJpy: run.initialCapitalJpy,
    allowMargin: run.allowMargin,
    startDate: date,
    endDate: date,
    initialPortfolio,
    promptVersion: strategy.promptVersion,
    modelName: process.env.HERMES_MODE === 'api' ? (process.env.AI_API_MODEL ?? 'api') : 'mock-hermes',
  });
  const result = await engine.run();

  // Replace open positions with the day's final state; everything else appends.
  await prisma.position.deleteMany({ where: { paperRunId, status: 'open' } });
  await persistRunResult({
    runType: 'paper',
    runId: paperRunId,
    strategyVersionId: run.strategyVersionId,
    result,
  });

  await updateRunSummary(paperRunId, run.initialCapitalJpy);
  const filled = result.executions.filter((e) => e.side === 'buy').length;
  await audit('system', 'paper.daily_step', 'PaperRun', paperRunId, {
    date,
    ordersFilled: filled,
    closedTrades: result.closedTrades.length,
  });

  return {
    processed: true,
    date,
    ordersFilled: filled,
    closedTrades: result.closedTrades.length,
    equityJpy: result.snapshots.at(-1)?.equityJpy,
  };
}

// Runs currently catching up, shared across all callers (go-live, scheduler,
// manual) so a long AI catch-up can never overlap itself for the same run.
const catchingUp = new Set<string>();

export function isCatchingUp(paperRunId: string): boolean {
  return catchingUp.has(paperRunId);
}

/** Catch a run up to the latest available trading day (bounded loop, single-flight). */
export async function catchUpRun(paperRunId: string, maxDays = 60): Promise<DailyStepResult[]> {
  if (catchingUp.has(paperRunId)) return [];
  catchingUp.add(paperRunId);
  try {
    const steps: DailyStepResult[] = [];
    for (let i = 0; i < maxDays; i++) {
      let step: DailyStepResult;
      try {
        step = await runDailyStep(paperRunId);
      } catch (err) {
        // One bad day must not silently kill the whole live loop.
        console.error(`[liveTrading] runDailyStep failed for ${paperRunId}:`, err);
        break;
      }
      if (!step.processed) break;
      steps.push(step);
    }
    return steps;
  } finally {
    catchingUp.delete(paperRunId);
  }
}

/** Recompute the run-level cumulative summary from all persisted snapshots/trades. */
async function updateRunSummary(paperRunId: string, initialCapitalJpy: number): Promise<void> {
  const last = await prisma.portfolioSnapshot.findFirst({
    where: { paperRunId },
    orderBy: { snapshotDate: 'desc' },
  });
  if (!last) return;
  const dd = await prisma.portfolioSnapshot.aggregate({
    where: { paperRunId },
    _max: { drawdownPct: true },
  });
  const trades = await prisma.tradeEpisode.findMany({
    where: { paperRunId, exitDate: { not: null } },
    select: { pnlJpy: true },
  });
  const wins = trades.filter((t) => (t.pnlJpy ?? 0) > 0).length;
  const winRatePct = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  await prisma.paperRun.update({
    where: { id: paperRunId },
    data: {
      summaryJson: {
        finalEquityJpy: last.equityJpy,
        totalReturnPct: last.totalReturnPct,
        maxDrawdownPct: dd._max.drawdownPct ?? 0,
        winRatePct,
        tradeCount: trades.length,
        lastProcessedDate: isoDay(last.snapshotDate),
        initialCapitalJpy,
      },
    },
  });
}
