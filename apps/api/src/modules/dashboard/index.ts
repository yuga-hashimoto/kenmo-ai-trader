import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dashboard/summary', async () => {
    const [latestBacktests, runningPaper, champion, recentAgentRuns, recentOrders, counts] =
      await Promise.all([
        prisma.backtestRun.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { strategyVersion: { select: { name: true } } },
        }),
        prisma.paperRun.findMany({ where: { status: 'running' }, take: 5 }),
        prisma.strategyVersion.findFirst({ where: { status: 'champion' } }),
        prisma.agentRun.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
        prisma.order.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          where: { status: 'filled' },
        }),
        prisma.$transaction([
          prisma.backtestRun.count(),
          prisma.paperRun.count(),
          prisma.strategyVersion.count(),
        ]),
      ]);

    return {
      counts: {
        backtests: counts[0],
        paperRuns: counts[1],
        strategies: counts[2],
      },
      latestBacktests,
      runningPaper,
      champion,
      recentAgentRuns,
      recentOrders,
    };
  });
}
