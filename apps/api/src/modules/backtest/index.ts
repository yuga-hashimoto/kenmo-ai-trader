import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@kenmo/db';
import { BacktestEngine } from '@kenmo/core';
import { loadMarketDataProvider } from '../../lib/marketData.js';
import { parseStrategyConfig } from '../../lib/config.js';
import { getAgent } from '../../lib/agent.js';
import { persistRunResult } from '../../lib/persist.js';
import { audit } from '../audit/index.js';

const createSchema = z.object({
  name: z.string().min(1).optional(),
  initialCapitalJpy: z.number().positive(),
  allowMargin: z.boolean(),
  startDate: z.string(),
  endDate: z.string(),
  strategyVersionId: z.string().optional(),
});

/** Run the engine for a backtest run and persist everything. */
export async function runBacktest(id: string): Promise<void> {
  const run = await prisma.backtestRun.findUnique({ where: { id } });
  if (!run) throw new Error('backtest not found');
  if (run.status === 'running') throw new Error('backtest already running');

  await prisma.backtestRun.update({
    where: { id },
    data: { status: 'running', startedAt: new Date(), errorMessage: null },
  });

  try {
    const strategy = await prisma.strategyVersion.findUnique({
      where: { id: run.strategyVersionId },
    });
    if (!strategy) throw new Error('strategy version not found');

    const provider = await loadMarketDataProvider();
    const engine = new BacktestEngine({
      provider,
      agent: getAgent(),
      config: parseStrategyConfig(strategy.configJson),
      initialCapitalJpy: run.initialCapitalJpy,
      allowMargin: run.allowMargin,
      startDate: run.startDate.toISOString().slice(0, 10),
      endDate: run.endDate.toISOString().slice(0, 10),
      promptVersion: strategy.promptVersion,
      // Mirror the live loop so a backtest predicts live behaviour: decide on the
      // prior session's data (no same-day look-ahead), one decision/day, intraday
      // standing exits, capital-aware sizing, and entries filled at the close.
      decideAsOfPriorTradingDay: true,
      singleDailySession: true,
      intradayRiskExits: true,
      capitalAwareCandidates: true,
      fillEntriesAtClose: true,
    });
    const result = await engine.run();

    await persistRunResult({
      runType: 'backtest',
      runId: id,
      strategyVersionId: run.strategyVersionId,
      result,
    });

    await prisma.backtestRun.update({
      where: { id },
      data: {
        status: 'completed',
        finishedAt: new Date(),
        summaryJson: result.summary as unknown as object,
      },
    });
    await audit('system', 'backtest.completed', 'BacktestRun', id, {
      totalReturnPct: result.summary.totalReturnPct,
      trades: result.summary.tradeCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.backtestRun.update({
      where: { id },
      data: { status: 'failed', finishedAt: new Date(), errorMessage: message },
    });
    await audit('system', 'backtest.failed', 'BacktestRun', id, { message });
    throw err;
  }
}

export async function backtestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/backtests', async (req, reply) => {
    const body = createSchema.parse(req.body);
    let strategyVersionId = body.strategyVersionId;
    if (!strategyVersionId) {
      const champion = await prisma.strategyVersion.findFirst({
        where: { status: 'champion' },
        orderBy: { createdAt: 'desc' },
      });
      if (!champion) return reply.code(400).send({ error: 'no champion strategy; run seed first' });
      strategyVersionId = champion.id;
    }
    const run = await prisma.backtestRun.create({
      data: {
        name: body.name ?? `Backtest ${new Date().toISOString().slice(0, 16)}`,
        initialCapitalJpy: body.initialCapitalJpy,
        allowMargin: body.allowMargin,
        startDate: new Date(`${body.startDate}T00:00:00Z`),
        endDate: new Date(`${body.endDate}T00:00:00Z`),
        strategyVersionId,
        status: 'pending',
      },
    });
    await audit('user', 'backtest.created', 'BacktestRun', run.id, { name: run.name });
    return reply.code(201).send({ id: run.id, run });
  });

  app.post<{ Params: { id: string } }>('/api/backtests/:id/run', async (req, reply) => {
    // run synchronously (seed dataset is small); for big universes move to a queue.
    await runBacktest(req.params.id);
    const run = await prisma.backtestRun.findUnique({ where: { id: req.params.id } });
    return reply.send(run);
  });

  app.get('/api/backtests', async () => {
    return prisma.backtestRun.findMany({
      orderBy: { createdAt: 'desc' },
      include: { strategyVersion: { select: { name: true, status: true } } },
    });
  });

  app.get<{ Params: { id: string } }>('/api/backtests/:id', async (req, reply) => {
    const run = await prisma.backtestRun.findUnique({
      where: { id: req.params.id },
      include: { strategyVersion: true },
    });
    if (!run) return reply.code(404).send({ error: 'not found' });
    const [orderCount, tradeCount] = await Promise.all([
      prisma.order.count({ where: { backtestRunId: run.id } }),
      prisma.tradeEpisode.count({ where: { backtestRunId: run.id } }),
    ]);
    return reply.send({ ...run, orderCount, tradeCount });
  });

  app.get<{ Params: { id: string } }>('/api/backtests/:id/snapshots', async (req) => {
    return prisma.portfolioSnapshot.findMany({
      where: { backtestRunId: req.params.id },
      orderBy: { snapshotDate: 'asc' },
    });
  });

  app.get<{ Params: { id: string } }>('/api/backtests/:id/orders', async (req) => {
    return prisma.order.findMany({
      where: { backtestRunId: req.params.id },
      orderBy: { createdAt: 'asc' },
      include: { executions: true },
    });
  });

  app.get<{ Params: { id: string } }>('/api/backtests/:id/trades', async (req) => {
    return prisma.tradeEpisode.findMany({
      where: { backtestRunId: req.params.id },
      orderBy: { entryDate: 'asc' },
    });
  });

  app.get<{ Params: { id: string; tradeId: string } }>(
    '/api/backtests/:id/trades/:tradeId',
    async (req, reply) => {
      const trade = await prisma.tradeEpisode.findUnique({ where: { id: req.params.tradeId } });
      if (!trade) return reply.code(404).send({ error: 'not found' });
      return reply.send(trade);
    },
  );

  app.get<{ Params: { id: string } }>('/api/backtests/:id/agent-runs', async (req) => {
    return prisma.agentRun.findMany({
      where: { backtestRunId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
  });

  app.get<{ Params: { id: string } }>('/api/backtests/:id/scheduler-events', async (req) => {
    return prisma.schedulerEvent.findMany({
      where: { backtestRunId: req.params.id },
      orderBy: [{ eventDate: 'asc' }, { virtualTime: 'asc' }],
    });
  });
}
