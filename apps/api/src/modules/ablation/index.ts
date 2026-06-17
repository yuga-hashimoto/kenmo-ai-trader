import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';
import { generateAblationVariants, type BacktestSummary } from '@kenmo/core';
import { parseStrategyConfig } from '../../lib/config.js';
import { runBacktest } from '../backtest/index.js';
import { audit } from '../audit/index.js';

export async function ablationRoutes(app: FastifyInstance): Promise<void> {
  // Run the ablation matrix: same period, advanced filters toggled per variant.
  app.post<{ Params: { id: string } }>('/api/backtests/:id/ablation', async (req, reply) => {
    const source = await prisma.backtestRun.findUnique({
      where: { id: req.params.id },
      include: { strategyVersion: true },
    });
    if (!source) return reply.code(404).send({ error: 'not found' });

    const baseConfig = parseStrategyConfig(source.strategyVersion.configJson);
    const variants = generateAblationVariants(baseConfig);
    const results = [];

    for (const variant of variants) {
      const sv = await prisma.strategyVersion.create({
        data: {
          name: `${source.strategyVersion.name}/ablation/${variant.name}`,
          parentVersionId: source.strategyVersionId,
          status: 'archived',
          configJson: variant.config as unknown as object,
          promptVersion: source.strategyVersion.promptVersion,
          createdBy: 'system',
          createdReason: `ablation variant: ${variant.name}`,
        },
      });
      const run = await prisma.backtestRun.create({
        data: {
          name: `${source.name} · ${variant.name}`,
          initialCapitalJpy: source.initialCapitalJpy,
          allowMargin: source.allowMargin,
          startDate: source.startDate,
          endDate: source.endDate,
          strategyVersionId: sv.id,
          status: 'pending',
        },
      });
      await runBacktest(run.id);
      const completed = await prisma.backtestRun.findUnique({ where: { id: run.id } });
      const s = (completed?.summaryJson ?? null) as BacktestSummary | null;
      const result = await prisma.ablationResult.create({
        data: {
          sourceBacktestRunId: source.id,
          name: variant.name,
          strategyVersionId: sv.id,
          backtestRunId: run.id,
          finalEquityJpy: s?.finalEquityJpy ?? 0,
          totalReturnPct: s?.totalReturnPct ?? 0,
          annualizedReturnPct: s?.annualizedReturnPct ?? 0,
          maxDrawdownPct: s?.maxDrawdownPct ?? 0,
          winRatePct: s?.winRatePct ?? 0,
          profitFactor: Number.isFinite(s?.profitFactor) ? (s?.profitFactor ?? 0) : 999,
          avgWinPct: s?.avgWinPct ?? 0,
          avgLossPct: s?.avgLossPct ?? 0,
          tradeCount: s?.tradeCount ?? 0,
        },
      });
      results.push(result);
    }

    await audit('system', 'ablation.completed', 'BacktestRun', source.id, {
      variants: results.length,
    });
    return reply.code(201).send(results);
  });

  app.get<{ Params: { id: string } }>('/api/backtests/:id/ablation', async (req) => {
    return prisma.ablationResult.findMany({
      where: { sourceBacktestRunId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
  });
}
