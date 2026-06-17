import { PrismaClient } from '@prisma/client';
import { buildSampleDataset, DEFAULT_STRATEGY_CONFIG } from '@kenmo/core';

const prisma = new PrismaClient();
const toDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

async function main(): Promise<void> {
  console.log('Seeding kenmo-ai-trader…');
  const dataset = buildSampleDataset();

  // Clean slate for idempotent re-seeding (children first via FKs / cascade).
  await prisma.dailyPrice.deleteMany();
  await prisma.financialResult.deleteMany();
  await prisma.disclosure.deleteMany();
  await prisma.symbol.deleteMany();
  await prisma.userSetting.deleteMany();
  await prisma.strategyVersion.deleteMany({ where: { name: 'kenmo-v1' } });

  // Symbols
  for (const s of dataset.symbols) {
    await prisma.symbol.create({
      data: {
        code: s.code,
        name: s.name,
        market: s.market,
        sector: s.sector,
        marketCapJpy: s.marketCapJpy ?? null,
        lotSize: s.lotSize,
        isActive: s.isActive,
      },
    });
  }
  console.log(`  ${dataset.symbols.length} symbols`);

  // Daily prices (bulk)
  await prisma.dailyPrice.createMany({
    data: dataset.prices.map((b) => ({
      symbolCode: b.symbolCode,
      date: toDate(b.date),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      turnoverValue: b.turnoverValue,
    })),
  });
  console.log(`  ${dataset.prices.length} daily prices`);

  // Financial results
  await prisma.financialResult.createMany({
    data: dataset.financials.map((f) => ({
      symbolCode: f.symbolCode,
      announcedAt: toDate(f.announcedAt),
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
      guidanceRevision: f.guidanceRevision,
      rawJson: f as unknown as object,
    })),
  });
  console.log(`  ${dataset.financials.length} financial results`);

  // Disclosures
  await prisma.disclosure.createMany({
    data: dataset.disclosures.map((d) => ({
      symbolCode: d.symbolCode,
      disclosedAt: toDate(d.disclosedAt),
      disclosureType: d.disclosureType,
      title: d.title,
      summary: d.summary,
      rawJson: d as unknown as object,
    })),
  });
  console.log(`  ${dataset.disclosures.length} disclosures`);

  // Champion strategy version (kenmo-v1)
  const champion = await prisma.strategyVersion.create({
    data: {
      name: 'kenmo-v1',
      status: 'champion',
      configJson: DEFAULT_STRATEGY_CONFIG as unknown as object,
      promptVersion: 'kenmo-v1',
      createdBy: 'system',
      createdReason: 'Initial champion strategy based on kenmo mid/small-cap growth method',
    },
  });
  console.log(`  champion strategy ${champion.id} (kenmo-v1)`);

  // Default user setting (backtest mode, live disabled)
  await prisma.userSetting.create({
    data: {
      initialCapitalJpy: 1_000_000,
      allowMargin: false,
      defaultStrategyVersionId: champion.id,
      tradingMode: 'backtest',
      liveTradingEnabled: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: 'system',
      action: 'seed',
      targetType: 'database',
      payloadJson: { symbols: dataset.symbols.length, prices: dataset.prices.length },
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
