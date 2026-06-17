import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';
import {
  applyConfigChanges,
  buildSummaryForAI,
  compareStrategies,
  type BacktestSummary,
  type ClosedTrade,
  type ConfigChange,
  type LossType,
  type TradeRecordForAI,
} from '@kenmo/core';
import { getAgent } from '../../lib/agent.js';
import { parseStrategyConfig } from '../../lib/config.js';
import { audit } from '../audit/index.js';

export async function evolutionRoutes(app: FastifyInstance): Promise<void> {
  // Review a completed backtest and create a Challenger strategy version.
  app.post<{ Params: { id: string } }>('/api/backtests/:id/evolve', async (req, reply) => {
    const run = await prisma.backtestRun.findUnique({
      where: { id: req.params.id },
      include: { strategyVersion: true },
    });
    if (!run) return reply.code(404).send({ error: 'not found' });
    if (run.status !== 'completed' || !run.summaryJson) {
      return reply.code(400).send({ error: 'backtest not completed' });
    }

    const summary = run.summaryJson as unknown as BacktestSummary;
    const episodes = await prisma.tradeEpisode.findMany({
      where: { backtestRunId: run.id },
    });
    const closedTrades: ClosedTrade[] = episodes
      .filter((e) => e.exitDate && e.pnlJpy !== null)
      .map((e) => ({
        symbolCode: e.symbolCode,
        strategy: e.strategy,
        entryDate: e.entryDate.toISOString().slice(0, 10),
        exitDate: e.exitDate!.toISOString().slice(0, 10),
        entryPrice: e.entryPrice,
        exitPrice: e.exitPrice ?? 0,
        quantity: e.quantity,
        pnlJpy: e.pnlJpy ?? 0,
        pnlPct: e.pnlPct ?? 0,
        holdingDays: e.holdingDays ?? 0,
        entryReason: e.entryReason,
        exitReason: e.exitReason ?? '',
      }));

    const tradeRecords: TradeRecordForAI[] = episodes.map((e) => ({
      symbolCode: e.symbolCode,
      pnlJpy: e.pnlJpy ?? 0,
      pnlPct: e.pnlPct ?? 0,
      lossType: (e.lossType as LossType | null) ?? null,
      features: (e.featuresAtEntryJson ?? {}) as TradeRecordForAI['features'],
    }));

    const forAI = buildSummaryForAI({
      strategyVersion: run.strategyVersion.name,
      summary,
      closedTrades,
      tradeRecords,
    });

    const agent = getAgent();
    const proposal = await agent.reviewBacktest(forAI);

    const parentConfig = parseStrategyConfig(run.strategyVersion.configJson);
    const challengerConfig = applyConfigChanges(
      parentConfig,
      proposal.configChanges as ConfigChange[],
    );

    const challenger = await prisma.strategyVersion.create({
      data: {
        name: `${run.strategyVersion.name}-c${Date.now().toString(36).slice(-4)}`,
        parentVersionId: run.strategyVersion.id,
        status: 'challenger',
        configJson: challengerConfig as unknown as object,
        promptVersion: run.strategyVersion.promptVersion,
        createdBy: 'ai',
        createdReason: proposal.reason,
      },
    });

    const saved = await prisma.evolutionProposal.create({
      data: {
        sourceBacktestRunId: run.id,
        parentStrategyVersionId: run.strategyVersion.id,
        challengerStrategyVersionId: challenger.id,
        proposalJson: proposal as unknown as object,
        reason: proposal.reason,
        status: 'proposed',
      },
    });

    await audit('ai', 'evolution.challenger_created', 'StrategyVersion', challenger.id, {
      from: run.strategyVersion.name,
      changes: proposal.configChanges,
    });

    return reply.code(201).send({ proposal: saved, challenger });
  });

  app.get<{ Params: { id: string } }>('/api/backtests/:id/evolution', async (req) => {
    return prisma.evolutionProposal.findMany({
      where: { sourceBacktestRunId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  // Loss-type breakdown + filter attribution + an AI improvement preview.
  app.get<{ Params: { id: string } }>('/api/backtests/:id/loss-analysis', async (req, reply) => {
    const run = await prisma.backtestRun.findUnique({
      where: { id: req.params.id },
      include: { strategyVersion: true },
    });
    if (!run?.summaryJson) return reply.code(400).send({ error: 'backtest not completed' });

    const episodes = await prisma.tradeEpisode.findMany({ where: { backtestRunId: run.id } });
    const tradeRecords: TradeRecordForAI[] = episodes.map((e) => ({
      symbolCode: e.symbolCode,
      pnlJpy: e.pnlJpy ?? 0,
      pnlPct: e.pnlPct ?? 0,
      lossType: (e.lossType as LossType | null) ?? null,
      features: (e.featuresAtEntryJson ?? {}) as TradeRecordForAI['features'],
    }));
    const forAI = buildSummaryForAI({
      strategyVersion: run.strategyVersion.name,
      summary: run.summaryJson as unknown as BacktestSummary,
      closedTrades: [],
      tradeRecords,
    });
    const proposalPreview = await getAgent().reviewBacktest(forAI);
    return reply.send({
      lossTypeStats: forAI.lossTypeStats,
      filterAttribution: forAI.filterAttribution,
      proposalPreview,
    });
  });

  // Compare two completed backtests (champion vs challenger run).
  app.get<{ Querystring: { a?: string; b?: string } }>(
    '/api/evolution/compare',
    async (req, reply) => {
      const { a, b } = req.query;
      if (!a || !b) return reply.code(400).send({ error: 'pass ?a=<backtestId>&b=<backtestId>' });
      const [ra, rb] = await Promise.all([
        prisma.backtestRun.findUnique({ where: { id: a } }),
        prisma.backtestRun.findUnique({ where: { id: b } }),
      ]);
      if (!ra?.summaryJson || !rb?.summaryJson) {
        return reply.code(400).send({ error: 'both backtests must be completed' });
      }
      const verdict = compareStrategies(
        ra.summaryJson as unknown as BacktestSummary,
        rb.summaryJson as unknown as BacktestSummary,
      );
      return reply.send({ champion: ra.summaryJson, challenger: rb.summaryJson, verdict });
    },
  );
}
