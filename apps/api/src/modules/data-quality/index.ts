import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';
import { DataQualityService } from '@kenmo/core';

export async function dataQualityRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/data-quality/check — run quality checks on loaded data
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/data-quality/check',
    async (req) => {
      const from = req.query.from ?? '2020-01-01';
      const to = req.query.to ?? new Date().toISOString().slice(0, 10);

      const [symbols, prices, financials, disclosures] = await Promise.all([
        prisma.symbol.findMany(),
        prisma.dailyPrice.findMany({
          where: {
            date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
          },
          select: { symbolCode: true, date: true, open: true, high: true, low: true, close: true, volume: true, turnoverValue: true },
        }),
        prisma.financialResult.findMany({
          where: { announcedAt: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
          select: { symbolCode: true, announcedAt: true, fiscalPeriod: true, sales: true, operatingProfit: true, ordinaryProfit: true, netIncome: true, salesYoyPct: true, operatingProfitYoyPct: true, operatingMarginPct: true, operatingMarginPrevPct: true, roePct: true, progressRateOpPct: true, operatingCashFlowJpy: true, guidanceRevision: true },
        }),
        prisma.disclosure.findMany({
          where: { disclosedAt: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
          select: { symbolCode: true, disclosedAt: true, disclosureType: true, title: true, summary: true },
        }),
      ]);

      const tradingDates = [...new Set(prices.map((p) => p.date.toISOString().slice(0, 10)))].sort();

      const service = new DataQualityService();
      const report = service.check({
        symbols: symbols.map((s) => ({
          code: s.code,
          name: s.name,
          market: s.market,
          sector: s.sector,
          marketCapJpy: s.marketCapJpy,
          lotSize: s.lotSize,
          isActive: s.isActive,
        })),
        prices: prices.map((p) => ({
          symbolCode: p.symbolCode,
          date: p.date.toISOString().slice(0, 10),
          open: p.open,
          high: p.high,
          low: p.low,
          close: p.close,
          volume: p.volume,
          turnoverValue: p.turnoverValue,
        })),
        financials: financials.map((f) => ({
          symbolCode: f.symbolCode,
          announcedAt: f.announcedAt.toISOString().slice(0, 10),
          fiscalPeriod: f.fiscalPeriod,
          sales: f.sales,
          operatingProfit: f.operatingProfit,
          ordinaryProfit: f.ordinaryProfit,
          netIncome: f.netIncome,
          salesYoyPct: f.salesYoyPct,
          operatingProfitYoyPct: f.operatingProfitYoyPct,
          operatingMarginPct: f.operatingMarginPct,
          operatingMarginPrevPct: f.operatingMarginPrevPct,
          roePct: f.roePct,
          progressRateOpPct: f.progressRateOpPct,
          operatingCashFlowJpy: f.operatingCashFlowJpy ?? null,
          guidanceRevision: f.guidanceRevision as 'none' | 'up' | 'down',
        })),
        disclosures: disclosures.map((d) => ({
          symbolCode: d.symbolCode,
          disclosedAt: d.disclosedAt.toISOString(),
          disclosureType: d.disclosureType as 'earnings' | 'guidance_up' | 'guidance_down' | 'dividend_up' | 'midterm_plan' | 'monthly' | 'other',
          title: d.title,
          summary: d.summary,
        })),
        tradingDates,
        backtestStart: from,
        backtestEnd: to,
      });

      return report;
    },
  );

  // GET /api/data-quality/summary — quick stats
  app.get('/api/data-quality/summary', async () => {
    const [symbolCount, priceCount, financialCount, disclosureCount, indexPriceCount, ingestRunCount] =
      await Promise.all([
        prisma.symbol.count(),
        prisma.dailyPrice.count(),
        prisma.financialResult.count(),
        prisma.disclosure.count(),
        prisma.indexDailyPrice.count(),
        prisma.dataIngestionRun.count(),
      ]);

    const latestPrice = await prisma.dailyPrice.findFirst({ orderBy: { date: 'desc' } });
    const earliestPrice = await prisma.dailyPrice.findFirst({ orderBy: { date: 'asc' } });
    const activeSymbols = await prisma.symbol.count({ where: { isActive: true } });
    const inactiveSymbols = await prisma.symbol.count({ where: { isActive: false } });
    const latestRun = await prisma.dataIngestionRun.findFirst({ orderBy: { createdAt: 'desc' } });

    return {
      symbolCount,
      activeSymbols,
      inactiveSymbols,
      priceCount,
      financialCount,
      disclosureCount,
      indexPriceCount,
      ingestRunCount,
      priceRange: {
        from: earliestPrice?.date ?? null,
        to: latestPrice?.date ?? null,
      },
      lastIngestion: latestRun?.createdAt ?? null,
    };
  });

  // GET /api/data-quality/missing-prices — find symbols missing recent data
  app.get<{ Querystring: { asOf?: string; lookbackDays?: string } }>(
    '/api/data-quality/missing-prices',
    async (req) => {
      const asOf = req.query.asOf ?? new Date().toISOString().slice(0, 10);
      const lookbackDays = Number(req.query.lookbackDays ?? 30);
      const since = new Date(new Date(asOf).getTime() - lookbackDays * 86_400_000);

      const activeSymbols = await prisma.symbol.findMany({ where: { isActive: true } });
      const recentPrices = await prisma.dailyPrice.groupBy({
        by: ['symbolCode'],
        where: { date: { gte: since, lte: new Date(asOf) } },
        _count: true,
        _max: { date: true },
      });

      const priceMap = new Map(recentPrices.map((p) => [p.symbolCode, p]));
      const missing = activeSymbols.filter((s) => !priceMap.has(s.code));
      const stale = activeSymbols.filter((s) => {
        const r = priceMap.get(s.code);
        if (!r) return false;
        const maxDate = r._max.date;
        if (!maxDate) return true;
        const daysSince = (new Date(asOf).getTime() - maxDate.getTime()) / 86_400_000;
        return daysSince > 10;
      });

      return { asOf, missing: missing.map((s) => s.code), stale: stale.map((s) => s.code) };
    },
  );
}
