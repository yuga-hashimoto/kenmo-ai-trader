import { prisma, type Prisma } from '@kenmo/db';
import type { BacktestResult } from '@kenmo/core';

type RunType = 'backtest' | 'paper';
const day = (d: string): Date => new Date(`${d.slice(0, 10)}T00:00:00Z`);

/**
 * Persist an in-memory BacktestResult to Postgres for either a backtest or paper
 * run. Engine-generated ids are reused as primary keys so all cross-references
 * (order->execution, agentRun->schedulerEvent->order) stay intact.
 */
export async function persistRunResult(params: {
  runType: RunType;
  runId: string;
  strategyVersionId: string;
  result: BacktestResult;
}): Promise<void> {
  const { runType, runId, strategyVersionId, result } = params;
  const ref =
    runType === 'backtest' ? { backtestRunId: runId } : { paperRunId: runId };

  await prisma.agentRun.createMany({
    data: result.agentRuns.map((a) => ({
      id: a.id,
      runType,
      ...ref,
      strategyVersionId,
      agentRole: a.agentRole,
      taskType: a.taskType,
      modelName: a.modelName,
      promptVersion: a.promptVersion,
      inputJson: a.inputJson as unknown as Prisma.InputJsonValue,
      outputJson: a.outputJson as unknown as Prisma.InputJsonValue,
      inputHash: a.inputHash,
      outputValid: a.outputValid,
      createdAt: new Date(a.createdAt),
    })),
  });

  await prisma.schedulerEvent.createMany({
    data: result.schedulerEvents.map((e) => ({
      id: e.id,
      runType,
      ...ref,
      eventDate: day(e.eventDate),
      virtualTime: e.virtualTime,
      eventType: e.eventType,
      status: e.status,
      agentRunId: e.agentRunId,
      createdAt: new Date(e.createdAt),
      finishedAt: new Date(e.createdAt),
      errorMessage: e.errorMessage,
    })),
  });

  await prisma.order.createMany({
    data: result.orders.map((o) => ({
      id: o.id,
      runType,
      ...ref,
      agentRunId: o.agentRunId,
      schedulerEventId: o.schedulerEventId,
      symbolCode: o.symbolCode,
      side: o.side,
      orderType: o.orderType,
      requestedBudgetJpy: o.requestedBudgetJpy,
      requestedQuantity: o.requestedQuantity,
      finalQuantity: o.finalQuantity,
      limitPrice: o.limitPrice,
      status: o.status,
      reason: o.reason,
      rejectionReason: o.rejectionReason,
      doNotBuyReasonsJson: o.doNotBuyReasons as unknown as Prisma.InputJsonValue,
      strategy: o.strategy,
      confidence: o.confidence,
      createdAt: day(o.createdAt),
    })),
  });

  await prisma.execution.createMany({
    data: result.executions.map((x) => ({
      id: x.id,
      orderId: x.orderId,
      runType,
      ...ref,
      symbolCode: x.symbolCode,
      side: x.side,
      quantity: x.quantity,
      executionPrice: x.executionPrice,
      commissionJpy: x.commissionJpy,
      slippageJpy: x.slippageJpy,
      executedAt: day(x.executedAt),
    })),
  });

  await prisma.portfolioSnapshot.createMany({
    data: result.snapshots.map((s) => ({
      runType,
      ...ref,
      snapshotDate: day(s.snapshotDate),
      cashJpy: s.cashJpy,
      marketValueJpy: s.marketValueJpy,
      equityJpy: s.equityJpy,
      realizedPnlJpy: s.realizedPnlJpy,
      unrealizedPnlJpy: s.unrealizedPnlJpy,
      totalReturnPct: s.totalReturnPct,
      drawdownPct: s.drawdownPct,
      exposurePct: s.exposurePct,
      positionsJson: s.positions as unknown as Prisma.InputJsonValue,
    })),
  });

  await prisma.tradeEpisode.createMany({
    data: result.tradeEpisodes.map((t) => ({
      runType,
      ...ref,
      symbolCode: t.symbolCode,
      strategy: t.strategy,
      entryDate: day(t.entryDate),
      exitDate: t.exitDate ? day(t.exitDate) : null,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      quantity: t.quantity,
      pnlJpy: t.pnlJpy,
      pnlPct: t.pnlPct,
      maxFavorableExcursionPct: t.maxFavorableExcursionPct,
      maxAdverseExcursionPct: t.maxAdverseExcursionPct,
      holdingDays: t.holdingDays,
      entryReason: t.entryReason,
      exitReason: t.exitReason,
      thesis: t.thesis,
      lossType: t.lossType,
      invalidationConditionsJson: t.invalidationConditions as unknown as Prisma.InputJsonValue,
      featuresAtEntryJson: t.featuresAtEntry as unknown as Prisma.InputJsonValue,
      outcomeLabelsJson: t.outcomeLabels as unknown as Prisma.InputJsonValue,
    })),
  });

  if (result.openPositions.length > 0) {
    await prisma.position.createMany({
      data: result.openPositions.map((p) => ({
        runType,
        ...ref,
        symbolCode: p.symbolCode,
        quantity: p.quantity,
        avgPrice: p.avgPrice,
        openedAt: day(p.entryDate),
        entryReason: p.entryReason,
        strategy: p.strategy,
        stopLossPrice: p.stopLossPrice,
        highestPriceSinceEntry: p.highestPriceSinceEntry,
        status: 'open',
      })),
    });
  }
}
