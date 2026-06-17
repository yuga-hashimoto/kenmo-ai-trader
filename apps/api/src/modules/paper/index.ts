import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@kenmo/db';
import { BacktestEngine } from '@kenmo/core';
import { loadMarketDataProvider } from '../../lib/marketData.js';
import { parseStrategyConfig } from '../../lib/config.js';
import { getAgent } from '../../lib/agent.js';
import { persistRunResult } from '../../lib/persist.js';
import { runDailyStep, catchUpRun } from '../../lib/liveTrading.js';
import { audit } from '../audit/index.js';

/**
 * PaperBrokerAdapter (MVP): paper trading reuses the same deterministic engine
 * over the available market history (a fast-forward "replay"), persisting orders,
 * executions, positions and snapshots exactly like a backtest but flagged as
 * runType=paper. A future RealtimeMarketScheduler would instead advance this run
 * one real trading day at a time off a live MarketDataProvider — the persistence
 * model and UI are already paper-aware. No real broker orders are ever sent.
 */
const createSchema = z.object({
  name: z.string().min(1).optional(),
  initialCapitalJpy: z.number().positive(),
  allowMargin: z.boolean(),
  strategyVersionId: z.string().optional(),
});

async function replayPaperRun(id: string): Promise<void> {
  const run = await prisma.paperRun.findUnique({ where: { id } });
  if (!run) throw new Error('paper run not found');
  const strategy = await prisma.strategyVersion.findUnique({
    where: { id: run.strategyVersionId },
  });
  if (!strategy) throw new Error('strategy version not found');

  // clear any prior replay data so start is idempotent
  await prisma.$transaction([
    prisma.execution.deleteMany({ where: { paperRunId: id } }),
    prisma.order.deleteMany({ where: { paperRunId: id } }),
    prisma.schedulerEvent.deleteMany({ where: { paperRunId: id } }),
    prisma.agentRun.deleteMany({ where: { paperRunId: id } }),
    prisma.portfolioSnapshot.deleteMany({ where: { paperRunId: id } }),
    prisma.tradeEpisode.deleteMany({ where: { paperRunId: id } }),
    prisma.position.deleteMany({ where: { paperRunId: id } }),
  ]);

  const provider = await loadMarketDataProvider();
  const dates = await provider.getTradingDates();
  if (dates.length === 0) throw new Error('no market data; run seed first');

  const engine = new BacktestEngine({
    provider,
    agent: getAgent(),
    config: parseStrategyConfig(strategy.configJson),
    initialCapitalJpy: run.initialCapitalJpy,
    allowMargin: run.allowMargin,
    startDate: dates[0]!,
    endDate: dates[dates.length - 1]!,
    promptVersion: strategy.promptVersion,
    modelName: process.env.HERMES_MODE === 'remote' ? 'hermes-remote' : 'mock-hermes',
  });
  const result = await engine.run();

  await persistRunResult({
    runType: 'paper',
    runId: id,
    strategyVersionId: run.strategyVersionId,
    result,
  });
  await prisma.paperRun.update({
    where: { id },
    data: { summaryJson: result.summary as unknown as object },
  });
}

export async function paperRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/paper-runs', async (req, reply) => {
    const body = createSchema.parse(req.body);
    let strategyVersionId = body.strategyVersionId;
    if (!strategyVersionId) {
      const champion = await prisma.strategyVersion.findFirst({ where: { status: 'champion' } });
      if (!champion) return reply.code(400).send({ error: 'no champion strategy; run seed first' });
      strategyVersionId = champion.id;
    }
    const run = await prisma.paperRun.create({
      data: {
        name: body.name ?? `Paper ${new Date().toISOString().slice(0, 16)}`,
        initialCapitalJpy: body.initialCapitalJpy,
        allowMargin: body.allowMargin,
        strategyVersionId,
        status: 'paused',
      },
    });
    await audit('user', 'paper.created', 'PaperRun', run.id, { name: run.name });
    return reply.code(201).send({ id: run.id, run });
  });

  app.post<{ Params: { id: string } }>('/api/paper-runs/:id/start', async (req, reply) => {
    await replayPaperRun(req.params.id);
    const run = await prisma.paperRun.update({
      where: { id: req.params.id },
      data: { status: 'running', startedAt: new Date(), stoppedAt: null },
    });
    await audit('user', 'paper.started', 'PaperRun', run.id, {});
    return reply.send(run);
  });

  const setStatus = (status: 'paused' | 'running' | 'stopped') =>
    async (req: { params: { id: string } }) => {
      const data: { status: typeof status; stoppedAt?: Date } = { status };
      if (status === 'stopped') data.stoppedAt = new Date();
      const run = await prisma.paperRun.update({ where: { id: req.params.id }, data });
      await audit('user', `paper.${status}`, 'PaperRun', run.id, {});
      return run;
    };

  // ---- Live trading (forward, day-by-day; no historical replay) ----
  // Advance exactly one unprocessed trading day for this run.
  app.post<{ Params: { id: string } }>('/api/paper-runs/:id/step', async (req) => {
    return runDailyStep(req.params.id);
  });

  // Mark the run live and catch it up to the latest available market day in the
  // background (the first catch-up over historical days can take a while with a
  // real AI provider, so it is not awaited).
  app.post<{ Params: { id: string } }>('/api/paper-runs/:id/go-live', async (req, reply) => {
    const run = await prisma.paperRun.update({
      where: { id: req.params.id },
      data: { status: 'running', startedAt: new Date(), stoppedAt: null },
    });
    await audit('user', 'paper.go_live', 'PaperRun', run.id, {});
    void catchUpRun(run.id).catch(() => undefined);
    return reply.send({ ...run, message: 'live trading started; catching up in background' });
  });

  app.post<{ Params: { id: string } }>('/api/paper-runs/:id/pause', setStatus('paused'));
  app.post<{ Params: { id: string } }>('/api/paper-runs/:id/resume', setStatus('running'));
  app.post<{ Params: { id: string } }>('/api/paper-runs/:id/stop', setStatus('stopped'));

  app.get('/api/paper-runs', async () => {
    return prisma.paperRun.findMany({
      orderBy: { createdAt: 'desc' },
      include: { strategyVersion: { select: { name: true, status: true } } },
    });
  });

  app.get<{ Params: { id: string } }>('/api/paper-runs/:id', async (req, reply) => {
    const run = await prisma.paperRun.findUnique({
      where: { id: req.params.id },
      include: { strategyVersion: true },
    });
    if (!run) return reply.code(404).send({ error: 'not found' });
    const positions = await prisma.position.findMany({
      where: { paperRunId: run.id, status: 'open' },
    });
    return reply.send({ ...run, openPositions: positions });
  });

  app.get<{ Params: { id: string } }>('/api/paper-runs/:id/snapshots', async (req) => {
    return prisma.portfolioSnapshot.findMany({
      where: { paperRunId: req.params.id },
      orderBy: { snapshotDate: 'asc' },
    });
  });

  app.get<{ Params: { id: string } }>('/api/paper-runs/:id/orders', async (req) => {
    const orders = await prisma.order.findMany({
      where: { paperRunId: req.params.id },
      orderBy: { createdAt: 'asc' },
      include: { executions: true },
    });
    // Attach the deciding session's time-of-day (場前/寄り/引け) so the UI can show
    // "when" a trade happened beyond just the date (daily-bar model has no minute fills).
    const eventIds = [...new Set(orders.map((o) => o.schedulerEventId).filter(Boolean))] as string[];
    const events = eventIds.length
      ? await prisma.schedulerEvent.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, virtualTime: true, eventType: true },
        })
      : [];
    const timeById = new Map(events.map((e) => [e.id, e]));
    return orders.map((o) => {
      const ev = o.schedulerEventId ? timeById.get(o.schedulerEventId) : undefined;
      const exec = o.executions[0];
      return {
        ...o,
        sessionTime: ev?.virtualTime ?? null,
        sessionType: ev?.eventType ?? null,
        executionPrice: exec?.executionPrice ?? null,
        executedQuantity: exec?.quantity ?? null,
        executedAt: exec?.executedAt ?? null,
      };
    });
  });

  app.get<{ Params: { id: string } }>('/api/paper-runs/:id/trades', async (req) => {
    return prisma.tradeEpisode.findMany({
      where: { paperRunId: req.params.id },
      orderBy: { entryDate: 'asc' },
    });
  });

  app.get<{ Params: { id: string } }>('/api/paper-runs/:id/agent-runs', async (req) => {
    return prisma.agentRun.findMany({
      where: { paperRunId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
  });
}
