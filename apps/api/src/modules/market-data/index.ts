import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';

export async function marketDataRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/symbols', async () => {
    return prisma.symbol.findMany({ orderBy: { code: 'asc' } });
  });

  app.get<{ Params: { code: string } }>('/api/symbols/:code', async (req, reply) => {
    const symbol = await prisma.symbol.findUnique({ where: { code: req.params.code } });
    if (!symbol) return reply.code(404).send({ error: 'not found' });
    return reply.send(symbol);
  });

  app.get<{ Params: { code: string }; Querystring: { from?: string; to?: string } }>(
    '/api/symbols/:code/prices',
    async (req) => {
      const where: { symbolCode: string; date?: { gte?: Date; lte?: Date } } = {
        symbolCode: req.params.code,
      };
      if (req.query.from || req.query.to) {
        where.date = {};
        if (req.query.from) where.date.gte = new Date(`${req.query.from}T00:00:00Z`);
        if (req.query.to) where.date.lte = new Date(`${req.query.to}T00:00:00Z`);
      }
      return prisma.dailyPrice.findMany({ where, orderBy: { date: 'asc' } });
    },
  );

  app.get<{ Params: { code: string } }>('/api/symbols/:code/financials', async (req) => {
    return prisma.financialResult.findMany({
      where: { symbolCode: req.params.code },
      orderBy: { announcedAt: 'desc' },
    });
  });

  app.get<{ Params: { code: string } }>('/api/symbols/:code/disclosures', async (req) => {
    return prisma.disclosure.findMany({
      where: { symbolCode: req.params.code },
      orderBy: { disclosedAt: 'desc' },
    });
  });
}
