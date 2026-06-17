import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';
import type { Prisma } from '@kenmo/db';
import { createHash } from 'node:crypto';
import {
  JQuantsProvider,
  CsvDataImporter,
  assertKnownDailyPriceSymbols,
  normalizeFinancialStatements,
  type DailyBar,
} from '@kenmo/core';

const DATASET_NAMES = [
  'listed_issue_master',
  'daily_prices',
  'index_prices',
  'topix_prices',
  'financial_statements',
  'earnings_calendar',
  'dividends',
  'margin_outstandings',
] as const;

type DatasetName = (typeof DATASET_NAMES)[number];

function responseMeta(payload: unknown): { responseSize: number; responseHash: string; rowCount: number } {
  const body = JSON.stringify(payload);
  return {
    responseSize: Buffer.byteLength(body),
    responseHash: createHash('sha256').update(body).digest('hex'),
    rowCount: Array.isArray(payload) ? payload.length : 1,
  };
}

async function saveRawApiSuccess(
  runId: string,
  endpoint: string,
  requestParams: Record<string, unknown>,
  payload: unknown,
): Promise<void> {
  await prisma.rawApiResponse.create({
    data: {
      ingestionRunId: runId,
      endpoint,
      requestParams: requestParams as Prisma.InputJsonValue,
      statusCode: 200,
      ...responseMeta(payload),
    },
  });
}

async function saveRawApiFailure(
  runId: string,
  endpoint: string,
  requestParams: Record<string, unknown>,
  error: unknown,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const status = errorMessage.match(/->\s*(\d{3})/)?.[1];
  await prisma.rawApiResponse.create({
    data: {
      ingestionRunId: runId,
      endpoint,
      requestParams: requestParams as Prisma.InputJsonValue,
      statusCode: status ? Number(status) : null,
      errorMessage,
    },
  });
}

async function assertDailyPriceSymbolsExist(rows: DailyBar[]): Promise<void> {
  const codes = [...new Set(rows.map((r) => r.symbolCode).filter(Boolean))];
  if (codes.length === 0) return;
  const existing = await prisma.symbol.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  assertKnownDailyPriceSymbols(rows, existing.map((s) => s.code));
}

async function runJQuantsIngestion(
  runId: string,
  datasetName: DatasetName,
  targetDate: Date,
): Promise<{ count: number }> {
  const endpoint = `jquants/${datasetName}`;
  const requestParams = { date: targetDate.toISOString().slice(0, 10) };
  const provider = new JQuantsProvider({
    baseUrl: process.env.JQUANTS_BASE_URL ?? 'https://api.jquants.com/v1',
    email: process.env.JQUANTS_EMAIL,
    password: process.env.JQUANTS_PASSWORD,
    refreshToken: process.env.JQUANTS_REFRESH_TOKEN,
    idToken: process.env.JQUANTS_ID_TOKEN,
    plan: (process.env.JQUANTS_PLAN ?? 'free') as 'free' | 'standard' | 'premium',
    enableAddons: process.env.JQUANTS_ENABLE_ADDONS === 'true',
  });

  try {
    switch (datasetName) {
    case 'listed_issue_master': {
      const rows = await provider.fetchListedIssueMaster(targetDate);
      await saveRawApiSuccess(runId, endpoint, requestParams, rows);
      let upserted = 0;
      for (const row of rows) {
        await prisma.symbol.upsert({
          where: { code: row.Code },
          create: {
            code: row.Code,
            name: row.CompanyName,
            market: row.MarketCodeName,
            sector: row.Sector17CodeName,
            isActive: true,
          },
          update: {
            name: row.CompanyName,
            market: row.MarketCodeName,
            sector: row.Sector17CodeName,
          },
        });
        upserted++;
      }
      return { count: upserted };
    }

    case 'daily_prices': {
      const rows = await provider.fetchDailyPrices(targetDate);
      await saveRawApiSuccess(runId, endpoint, requestParams, rows);
      await assertDailyPriceSymbolsExist(
        rows.map((row) => ({
          symbolCode: row.Code,
          date: row.Date,
          open: row.AdjustmentOpen ?? row.Open ?? 0,
          high: row.AdjustmentHigh ?? row.High ?? 0,
          low: row.AdjustmentLow ?? row.Low ?? 0,
          close: row.AdjustmentClose ?? row.Close ?? 0,
          volume: row.AdjustmentVolume ?? row.Volume ?? 0,
          turnoverValue: row.TurnoverValue ?? 0,
        })),
      );
      let upserted = 0;
      for (const row of rows) {
        if (row.Close == null) continue;
        await prisma.dailyPrice.upsert({
          where: { symbolCode_date: { symbolCode: row.Code, date: new Date(row.Date) } },
          create: {
            symbolCode: row.Code,
            date: new Date(row.Date),
            open: row.AdjustmentOpen ?? row.Open ?? 0,
            high: row.AdjustmentHigh ?? row.High ?? 0,
            low: row.AdjustmentLow ?? row.Low ?? 0,
            close: row.AdjustmentClose ?? row.Close,
            volume: row.AdjustmentVolume ?? row.Volume ?? 0,
            turnoverValue: row.TurnoverValue ?? 0,
          },
          update: {
            open: row.AdjustmentOpen ?? row.Open ?? 0,
            high: row.AdjustmentHigh ?? row.High ?? 0,
            low: row.AdjustmentLow ?? row.Low ?? 0,
            close: row.AdjustmentClose ?? row.Close,
            volume: row.AdjustmentVolume ?? row.Volume ?? 0,
            turnoverValue: row.TurnoverValue ?? 0,
          },
        });
        upserted++;
      }
      return { count: upserted };
    }

    case 'index_prices': {
      const rows = await provider.fetchIndexDailyPrices(targetDate);
      await saveRawApiSuccess(runId, endpoint, requestParams, rows);
      let upserted = 0;
      for (const row of rows) {
        if (row.Close == null) continue;
        await prisma.indexDailyPrice.upsert({
          where: { indexCode_date: { indexCode: row.Code, date: new Date(row.Date) } },
          create: {
            indexCode: row.Code,
            date: new Date(row.Date),
            open: row.Open ?? 0,
            high: row.High ?? 0,
            low: row.Low ?? 0,
            close: row.Close,
            volume: row.Volume,
          },
          update: {
            open: row.Open ?? 0,
            high: row.High ?? 0,
            low: row.Low ?? 0,
            close: row.Close,
            volume: row.Volume,
          },
        });
        upserted++;
      }
      return { count: upserted };
    }

    case 'topix_prices': {
      const rows = await provider.fetchTopixDailyPrices(targetDate);
      await saveRawApiSuccess(runId, endpoint, requestParams, rows);
      let upserted = 0;
      for (const row of rows) {
        if (row.Close == null) continue;
        await prisma.indexDailyPrice.upsert({
          where: { indexCode_date: { indexCode: 'TOPIX', date: new Date(row.Date) } },
          create: {
            indexCode: 'TOPIX',
            date: new Date(row.Date),
            open: row.Open ?? 0,
            high: row.High ?? 0,
            low: row.Low ?? 0,
            close: row.Close,
            volume: row.Volume,
          },
          update: {
            open: row.Open ?? 0,
            high: row.High ?? 0,
            low: row.Low ?? 0,
            close: row.Close,
            volume: row.Volume,
          },
        });
        upserted++;
      }
      return { count: upserted };
    }

    case 'financial_statements': {
      const rows = await provider.fetchFinancialStatements(targetDate);
      await saveRawApiSuccess(runId, endpoint, requestParams, rows);
      const normalizedRows = normalizeFinancialStatements(rows);
      let inserted = 0;
      for (const row of normalizedRows) {
        const announcedAt = new Date(row.announcedAt);
        if (row.sales === 0 && row.operatingProfit === 0) continue;
        const existing = await prisma.financialResult.findFirst({
          where: {
            symbolCode: row.symbolCode,
            fiscalPeriod: row.fiscalPeriod,
            announcedAt: { gte: new Date(announcedAt.getTime() - 3_600_000), lte: new Date(announcedAt.getTime() + 3_600_000) },
          },
        });
        if (!existing) {
          await prisma.financialResult.create({
            data: {
              symbolCode: row.symbolCode,
              announcedAt,
              fiscalPeriod: row.fiscalPeriod,
              sales: row.sales,
              operatingProfit: row.operatingProfit,
              ordinaryProfit: row.ordinaryProfit,
              netIncome: row.netIncome,
              salesYoyPct: row.salesYoyPct,
              operatingProfitYoyPct: row.operatingProfitYoyPct,
              operatingMarginPct: row.operatingMarginPct,
              operatingMarginPrevPct: row.operatingMarginPrevPct,
              roePct: row.roePct,
              progressRateOpPct: row.progressRateOpPct,
              guidanceRevision: row.guidanceRevision,
              rawJson: row.rawJson as unknown as Prisma.InputJsonValue,
            },
          });
          inserted++;
        }
      }
      return { count: inserted };
    }

    case 'earnings_calendar': {
      const from = new Date(targetDate);
      from.setDate(from.getDate() - 7);
      const to = new Date(targetDate);
      to.setDate(to.getDate() + 30);
      const rows = await provider.fetchEarningsCalendar(from, to);
      await saveRawApiSuccess(runId, endpoint, { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }, rows);
      let upserted = 0;
      for (const row of rows) {
        await prisma.earningsCalendar.upsert({
          where: { symbolCode_scheduledAt: { symbolCode: row.Code, scheduledAt: new Date(row.Date) } },
          create: {
            symbolCode: row.Code,
            scheduledAt: new Date(row.Date),
            fiscalPeriod: row.FiscalQuarter,
            source: 'jquants',
            rawJson: row as unknown as Prisma.InputJsonValue,
          },
          update: {
            fiscalPeriod: row.FiscalQuarter,
            rawJson: row as unknown as Prisma.InputJsonValue,
          },
        });
        upserted++;
      }
      return { count: upserted };
    }

    case 'dividends': {
      const rows = await provider.fetchDividends(targetDate);
      await saveRawApiSuccess(runId, endpoint, requestParams, rows);
      let inserted = 0;
      for (const row of rows) {
        const annualDiv = parseFloat(row.AnnualDividend) || 0;
        if (annualDiv === 0) continue;
        await prisma.dividend.create({
          data: {
            symbolCode: row.Code,
            announcedAt: new Date(row.AnnouncementDate),
            dividendPerShare: annualDiv,
            dividendType: 'annual',
            rawJson: row as unknown as Prisma.InputJsonValue,
          },
        });
        inserted++;
      }
      return { count: inserted };
    }

    case 'margin_outstandings': {
      const rows = await provider.fetchMarginOutstandings(targetDate);
      await saveRawApiSuccess(runId, endpoint, requestParams, rows);
      let upserted = 0;
      for (const row of rows) {
        await prisma.marginOutstanding.upsert({
          where: { symbolCode_date: { symbolCode: row.Code, date: new Date(row.Date) } },
          create: {
            symbolCode: row.Code,
            date: new Date(row.Date),
            marginBuyQty: parseFloat(row.LongMarginTradeVolume) || null,
            marginSellQty: parseFloat(row.ShortMarginTradeVolume) || null,
            rawJson: row as unknown as Prisma.InputJsonValue,
          },
          update: {
            marginBuyQty: parseFloat(row.LongMarginTradeVolume) || null,
            marginSellQty: parseFloat(row.ShortMarginTradeVolume) || null,
            rawJson: row as unknown as Prisma.InputJsonValue,
          },
        });
        upserted++;
      }
      return { count: upserted };
    }

    default:
      throw new Error(`Unsupported J-Quants dataset: ${datasetName}`);
    }
  } catch (error) {
    await saveRawApiFailure(runId, endpoint, requestParams, error);
    throw error;
  }
}

export async function dataIngestionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/data-ingestion/runs — list recent runs
  app.get<{ Querystring: { limit?: string; status?: string } }>(
    '/api/data-ingestion/runs',
    async (req) => {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const where = req.query.status ? { status: req.query.status as 'pending' | 'running' | 'completed' | 'failed' | 'skipped' } : {};
      return prisma.dataIngestionRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { dataSource: { select: { sourceType: true } } },
      });
    },
  );

  // GET /api/data-ingestion/runs/:id — run detail
  app.get<{ Params: { id: string } }>('/api/data-ingestion/runs/:id', async (req, reply) => {
    const run = await prisma.dataIngestionRun.findUnique({
      where: { id: req.params.id },
      include: {
        dataSource: true,
        rawResponses: { orderBy: { fetchedAt: 'desc' }, take: 20 },
      },
    });
    if (!run) return reply.code(404).send({ error: 'not found' });
    return run;
  });

  // POST /api/data-ingestion/runs — trigger a new ingestion job
  app.post<{
    Body: {
      sourceType: string;
      datasetName: string;
      targetDate?: string;
      fromDate?: string;
      toDate?: string;
    };
  }>('/api/data-ingestion/runs', async (req, reply) => {
    const { sourceType, datasetName, targetDate, fromDate, toDate } = req.body;

    const dataSource = await prisma.dataSource.upsert({
      where: { sourceType: sourceType as 'jquants' | 'tdnet' | 'edinet' | 'kabu_station' | 'csv' | 'seed' },
      create: { sourceType: sourceType as 'jquants' | 'tdnet' | 'edinet' | 'kabu_station' | 'csv' | 'seed', enabled: true },
      update: {},
    });

    const run = await prisma.dataIngestionRun.create({
      data: {
        dataSourceId: dataSource.id,
        datasetName,
        targetDate: targetDate ? new Date(targetDate) : null,
        fromDate: fromDate ? new Date(fromDate) : null,
        toDate: toDate ? new Date(toDate) : null,
        status: 'running',
        startedAt: new Date(),
      },
    });

    // Execute ingestion asynchronously
    setImmediate(async () => {
      try {
        let result: { count: number };
        if (sourceType === 'jquants') {
          result = await runJQuantsIngestion(
            run.id,
            datasetName as DatasetName,
            targetDate ? new Date(targetDate) : new Date(),
          );
        } else {
          throw new Error(`Unsupported ingestion source: ${sourceType}`);
        }
        await prisma.dataIngestionRun.update({
          where: { id: run.id },
          data: { status: 'completed', finishedAt: new Date(), recordCount: result.count },
        });
        await prisma.dataSource.update({
          where: { id: dataSource.id },
          data: {
            lastFetchedAt: new Date(),
            lastFetchCount: result.count,
            lastError: null,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.dataIngestionRun.update({
          where: { id: run.id },
          data: { status: 'failed', finishedAt: new Date(), errorMessage: msg },
        });
        await prisma.dataSource.update({
          where: { id: dataSource.id },
          data: { lastError: msg },
        });
      }
    });

    return reply.code(202).send(run);
  });

  // GET /api/data-ingestion/datasets — list available datasets per source
  app.get('/api/data-ingestion/datasets', async () => {
    return {
      jquants: DATASET_NAMES,
      csv: [
        'symbols',
        'daily_prices',
        'financial_statements',
        'disclosures',
        'index_prices',
        'margin',
        'short_selling',
      ],
      tdnet: [],
      edinet: [],
    };
  });

  // POST /api/data-ingestion/csv-import — import CSV data
  app.post<{
    Body: { datasetName: string; csvContent: string };
  }>('/api/data-ingestion/csv-import', async (req, reply) => {
    const { datasetName, csvContent } = req.body;
    if (!csvContent || !datasetName) {
      return reply.code(400).send({ error: 'datasetName and csvContent are required' });
    }

    let count = 0;
    switch (datasetName) {
      case 'symbols': {
        const rows = CsvDataImporter.importSymbolsCsv(csvContent);
        for (const row of rows) {
          await prisma.symbol.upsert({
            where: { code: row.code },
            create: row,
            update: { name: row.name, market: row.market, sector: row.sector, marketCapJpy: row.marketCapJpy, isActive: row.isActive },
          });
        }
        count = rows.length;
        break;
      }
      case 'daily_prices': {
        const rows = CsvDataImporter.importDailyPricesCsv(csvContent);
        await assertDailyPriceSymbolsExist(rows);
        for (const row of rows) {
          await prisma.dailyPrice.upsert({
            where: { symbolCode_date: { symbolCode: row.symbolCode, date: new Date(row.date) } },
            create: { ...row, date: new Date(row.date) },
            update: { open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume, turnoverValue: row.turnoverValue },
          });
        }
        count = rows.length;
        break;
      }
      case 'financial_statements': {
        const rows = CsvDataImporter.importFinancialStatementsCsv(csvContent);
        for (const row of rows) {
          await prisma.financialResult.create({
            data: { ...row, announcedAt: new Date(row.announcedAt) },
          });
        }
        count = rows.length;
        break;
      }
      case 'disclosures': {
        const rows = CsvDataImporter.importDisclosuresCsv(csvContent);
        for (const row of rows) {
          await prisma.disclosure.create({
            data: { ...row, disclosedAt: new Date(row.disclosedAt) },
          });
        }
        count = rows.length;
        break;
      }
      case 'index_prices': {
        const rows = CsvDataImporter.importIndexPricesCsv(csvContent);
        for (const row of rows) {
          await prisma.indexDailyPrice.upsert({
            where: { indexCode_date: { indexCode: row.indexCode, date: new Date(row.date) } },
            create: { ...row, date: new Date(row.date) },
            update: { open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume ?? null },
          });
        }
        count = rows.length;
        break;
      }
      case 'margin': {
        const rows = CsvDataImporter.importMarginCsv(csvContent);
        for (const row of rows) {
          await prisma.marginOutstanding.upsert({
            where: { symbolCode_date: { symbolCode: row.symbolCode, date: new Date(row.date) } },
            create: { ...row, date: new Date(row.date) },
            update: { marginBuyQty: row.marginBuyQty ?? null, marginSellQty: row.marginSellQty ?? null },
          });
        }
        count = rows.length;
        break;
      }
      case 'short_selling': {
        const rows = CsvDataImporter.importShortSellingCsv(csvContent);
        for (const row of rows) {
          await prisma.shortSellingPosition.create({
            data: { ...row, reportDate: new Date(row.reportDate) },
          });
        }
        count = rows.length;
        break;
      }
      default:
        return reply.code(400).send({ error: `Unknown dataset: ${datasetName}` });
    }

    return { imported: count, datasetName };
  });
}
