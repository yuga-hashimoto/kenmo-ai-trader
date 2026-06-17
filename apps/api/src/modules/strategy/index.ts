import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@kenmo/db';
import { DEFAULT_STRATEGY_CONFIG } from '@kenmo/core';
import { audit } from '../audit/index.js';

const createSchema = z.object({
  name: z.string().min(1),
  parentVersionId: z.string().optional(),
  configJson: z.unknown().optional(),
  promptVersion: z.string().optional(),
  createdReason: z.string().optional(),
});

export async function strategyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/strategies', async () => {
    return prisma.strategyVersion.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { backtestRuns: true, paperRuns: true } } },
    });
  });

  app.get<{ Params: { id: string } }>('/api/strategies/:id', async (req, reply) => {
    const sv = await prisma.strategyVersion.findUnique({
      where: { id: req.params.id },
      include: {
        backtestRuns: { orderBy: { createdAt: 'desc' } },
        paperRuns: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!sv) return reply.code(404).send({ error: 'not found' });
    return reply.send(sv);
  });

  app.post('/api/strategies', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const sv = await prisma.strategyVersion.create({
      data: {
        name: body.name,
        parentVersionId: body.parentVersionId ?? null,
        status: 'challenger',
        configJson: (body.configJson ?? DEFAULT_STRATEGY_CONFIG) as object,
        promptVersion: body.promptVersion ?? 'kenmo-v1',
        createdBy: 'human',
        createdReason: body.createdReason ?? null,
      },
    });
    await audit('user', 'strategy.created', 'StrategyVersion', sv.id, { name: sv.name });
    return reply.code(201).send(sv);
  });

  // Promote a challenger to champion (demotes the current champion to archived).
  app.post<{ Params: { id: string } }>('/api/strategies/:id/promote', async (req, reply) => {
    const sv = await prisma.strategyVersion.findUnique({ where: { id: req.params.id } });
    if (!sv) return reply.code(404).send({ error: 'not found' });

    await prisma.$transaction([
      prisma.strategyVersion.updateMany({
        where: { status: 'champion' },
        data: { status: 'archived' },
      }),
      prisma.strategyVersion.update({
        where: { id: sv.id },
        data: { status: 'champion' },
      }),
    ]);
    await audit('user', 'strategy.promoted', 'StrategyVersion', sv.id, { name: sv.name });
    return reply.send({ ok: true, championId: sv.id });
  });

  app.post<{ Params: { id: string } }>('/api/strategies/:id/archive', async (req, reply) => {
    const sv = await prisma.strategyVersion.update({
      where: { id: req.params.id },
      data: { status: 'archived' },
    });
    await audit('user', 'strategy.archived', 'StrategyVersion', sv.id, {});
    return reply.send(sv);
  });
}
