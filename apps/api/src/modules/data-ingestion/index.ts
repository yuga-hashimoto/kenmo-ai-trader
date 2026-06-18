import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';
import type { Prisma } from '@kenmo/db';
import { createHash } from 'node:crypto';
import {
  JQuantsProvider,
  YahooFinanceProvider,
  YFinancePythonProvider,
  JPXListedIssueProvider,
  createEdinetProvider,
  createTDnetProvider,
  CsvDataImporter,
  assertKnownDailyPriceSymbols,
  normalizeFinancialStatements,
  type DailyBar,
} from '@kenmo/core';
import { parseYahooFinanceMaxSymbols } from './yahooFinanceConfig.js';

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

const YAHOO_DATASET_NAMES = [
  'daily_prices',
  'index_prices',
  'dividends',
  'splits',
  'financial_statements',
  'earnings_calendar',
] as const;

type DatasetName = (typeof DATASET_NAMES)[number];
type YahooDatasetName = (typeof YAHOO_DATASET_NAMES)[number];
type SourceType = 'jquants' | 'yahoo_finance' | 'yfinance_python' | 'jpx' | 'tdnet' | 'edinet' | 'kabu_station' | 'csv' | 'seed';

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

// J-Quants Ingestion
async function runJQuantsIngestion(
  runId: string,
  datasetName: DatasetName,
  targetDate: Date,
): Promise<{ count: number }> {
  const endpoint = `jquants/${datasetName}`;
  const requestParams = { date: targetDate.toISOString().slice(0, 10) };
  const provider = new JQuantsProvider({
    baseUrl: process.env.JQUANTS_BASE_URL ?? (process.env.JQUANTS_API_KEY ? 'https://api.jquants.com/v2' : 'https://api.jquants.com/v1'),
    apiKey: process.env.JQUANTS_API_KEY,
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
      const existingSymbols = new Set(
        (
          await prisma.symbol.findMany({
            where: { code: { in: [...new Set(normalizedRows.map((row) => row.symbolCode))] } },
            select: { code: true },
          })
        ).map((symbol) => symbol.code),
      );
      let inserted = 0;
      for (const row of normalizedRows) {
        if (!existingSymbols.has(row.symbolCode)) continue;
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

// Helpers for Yahoo Finance / yfinance Python Ingestions
async function getIngestionSymbols(): Promise<string[]> {
  const configured = process.env.YAHOO_FINANCE_SYMBOLS?.split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) return configured;

  const maxSymbols = parseYahooFinanceMaxSymbols(process.env.YAHOO_FINANCE_MAX_SYMBOLS);
  const rows = await prisma.symbol.findMany({
    where: { isActive: true },
    select: { code: true },
    orderBy: { code: 'asc' },
    ...(maxSymbols ? { take: maxSymbols } : {}),
  });
  return rows.map((row) => row.code);
}

function mapYahooFinancials(yahooData: any, symbolCode: string): any[] {
  const incomeHistory = yahooData?.incomeStatementHistory?.incomeStatementHistory || [];
  const balanceHistory = yahooData?.balanceSheetHistory?.balanceSheetHistory || [];
  
  const results: any[] = [];
  
  for (let i = 0; i < incomeHistory.length; i++) {
    const inc = incomeHistory[i];
    const bal = balanceHistory[i] || {};
    
    const announcedAt = inc.endDate;
    if (!announcedAt) continue;
    
    const sales = inc.totalRevenue?.raw || 0;
    const operatingProfit = inc.operatingIncome?.raw || 0;
    const ordinaryProfit = operatingProfit;
    const netIncome = inc.netIncome?.raw || 0;
    
    // ROE uses shareholders' equity, NOT total assets (that would be ROA).
    const equity = bal.totalStockholderEquity?.raw || bal.commonStockEquity?.raw || 0;

    results.push({
      symbolCode,
      announcedAt: new Date(announcedAt),
      fiscalPeriod: `${new Date(announcedAt).getFullYear()}FY`,
      sales,
      operatingProfit,
      ordinaryProfit,
      netIncome,
      salesYoyPct: 0,
      operatingProfitYoyPct: 0,
      operatingMarginPct: sales > 0 ? (operatingProfit / sales) * 100 : 0,
      operatingMarginPrevPct: 0,
      roePct: equity > 0 ? (netIncome / equity) * 100 : 0,
      progressRateOpPct: 100,
      guidanceRevision: 'none',
      rawJson: { income: inc, balance: bal }
    });
  }
  
  results.sort((a, b) => a.announcedAt.getTime() - b.announcedAt.getTime());
  for (let i = 1; i < results.length; i++) {
    const cur = results[i];
    const prev = results[i - 1];
    
    if (prev.sales > 0) {
      cur.salesYoyPct = ((cur.sales - prev.sales) / prev.sales) * 100;
    }
    if (prev.operatingProfit > 0) {
      cur.operatingProfitYoyPct = ((cur.operatingProfit - prev.operatingProfit) / prev.operatingProfit) * 100;
    }
    cur.operatingMarginPrevPct = prev.operatingMarginPct;
  }
  
  return results;
}

function mapYFinancePythonFinancials(pyData: any, symbolCode: string): any[] {
  const fin = pyData?.financials || {};
  const bal = pyData?.balance_sheet || {};
  
  const dates = Object.keys(fin).sort();
  const results: any[] = [];
  
  for (const dateStr of dates) {
    const inc = fin[dateStr] || {};
    const bs = bal[dateStr] || {};
    
    const sales = inc["Total Revenue"] || inc["Revenue"] || 0;
    const operatingProfit = inc["Operating Income"] || inc["Operating Profit"] || 0;
    const ordinaryProfit = operatingProfit;
    const netIncome = inc["Net Income"] || 0;
    
    // ROE uses shareholders' equity, NOT total assets (that would be ROA).
    const equity =
      bs["Stockholders Equity"] ||
      bs["Total Equity Gross Minority Interest"] ||
      bs["Common Stock Equity"] ||
      0;
    
    results.push({
      symbolCode,
      announcedAt: new Date(dateStr),
      fiscalPeriod: `${new Date(dateStr).getFullYear()}FY`,
      sales,
      operatingProfit,
      ordinaryProfit,
      netIncome,
      salesYoyPct: 0,
      operatingProfitYoyPct: 0,
      operatingMarginPct: sales > 0 ? (operatingProfit / sales) * 100 : 0,
      operatingMarginPrevPct: 0,
      roePct: equity > 0 ? (netIncome / equity) * 100 : 0,
      progressRateOpPct: 100,
      guidanceRevision: 'none',
      rawJson: { income: inc, balance: bs }
    });
  }
  
  results.sort((a, b) => a.announcedAt.getTime() - b.announcedAt.getTime());
  for (let i = 1; i < results.length; i++) {
    const cur = results[i];
    const prev = results[i - 1];
    
    if (prev.sales > 0) {
      cur.salesYoyPct = ((cur.sales - prev.sales) / prev.sales) * 100;
    }
    if (prev.operatingProfit > 0) {
      cur.operatingProfitYoyPct = ((cur.operatingProfit - prev.operatingProfit) / prev.operatingProfit) * 100;
    }
    cur.operatingMarginPrevPct = prev.operatingMarginPct;
  }
  
  return results;
}

// Ingestion for Yahoo Finance or yfinance Python
async function runYahooOrPythonIngestion(
  runId: string,
  sourceType: 'yahoo_finance' | 'yfinance_python',
  datasetName: YahooDatasetName,
  fromDate?: Date,
  toDate?: Date,
  symbolsOverride?: string[],
): Promise<{ count: number }> {
  const from = fromDate || new Date();
  const to = toDate || new Date();
  
  const endpoint = `${sourceType}/${datasetName}`;
  const requestParams = {
    datasetName,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };

  const provider = sourceType === 'yahoo_finance' 
    ? new YahooFinanceProvider() 
    : new YFinancePythonProvider();

  const symbols =
    symbolsOverride && symbolsOverride.length > 0 ? symbolsOverride : await getIngestionSymbols();
  if (symbols.length === 0) {
    throw new Error(`${sourceType} ingestion requires active symbols in database.`);
  }

  let upserted = 0;
  let failed = 0;
  const failureExamples: string[] = [];
  const responsesLog: any[] = [];

  for (const symbol of symbols) {
    try {
      let currentSource: 'yahoo_finance' | 'yfinance_python' = sourceType;
      
      switch (datasetName) {
        case 'daily_prices': {
          let bars: DailyBar[] = [];
          try {
            bars = await provider.fetchDailyPrices(symbol, from, to);
          } catch (err) {
            if (sourceType === 'yahoo_finance') {
              console.warn(`[Ingestion] Yahoo Finance daily prices failed for ${symbol}. Retrying with Python yfinance...`, String(err));
              const fallbackProvider = new YFinancePythonProvider();
              bars = await fallbackProvider.fetchDailyPrices(symbol, from, to);
              currentSource = 'yfinance_python';
            } else {
              throw err;
            }
          }
          responsesLog.push({ symbol, count: bars.length, source: currentSource });
          
          for (const bar of bars) {
            await prisma.dailyPrice.upsert({
              where: { symbolCode_date: { symbolCode: symbol, date: new Date(bar.date) } },
              create: {
                symbolCode: symbol,
                date: new Date(bar.date),
                open: bar.open ?? 0,
                high: bar.high ?? 0,
                low: bar.low ?? 0,
                close: bar.close ?? 0,
                volume: bar.volume ?? 0,
                turnoverValue: bar.turnoverValue ?? 0,
              },
              update: {
                open: bar.open ?? 0,
                high: bar.high ?? 0,
                low: bar.low ?? 0,
                close: bar.close ?? 0,
                volume: bar.volume ?? 0,
                turnoverValue: bar.turnoverValue ?? 0,
              },
            });
            upserted++;
          }
          break;
        }

        case 'index_prices': {
          let bars: DailyBar[] = [];
          try {
            bars = await provider.fetchIndexDailyPrices(symbol, from, to);
          } catch (err) {
            if (sourceType === 'yahoo_finance') {
              console.warn(`[Ingestion] Yahoo Finance index prices failed for ${symbol}. Retrying with Python yfinance...`, String(err));
              const fallbackProvider = new YFinancePythonProvider();
              bars = await fallbackProvider.fetchIndexDailyPrices(symbol, from, to);
              currentSource = 'yfinance_python';
            } else {
              throw err;
            }
          }
          responsesLog.push({ symbol, count: bars.length, source: currentSource });

          for (const bar of bars) {
            await prisma.indexDailyPrice.upsert({
              where: { indexCode_date: { indexCode: symbol, date: new Date(bar.date) } },
              create: {
                indexCode: symbol,
                date: new Date(bar.date),
                open: bar.open ?? 0,
                high: bar.high ?? 0,
                low: bar.low ?? 0,
                close: bar.close ?? 0,
                volume: bar.volume ?? 0,
              },
              update: {
                open: bar.open ?? 0,
                high: bar.high ?? 0,
                low: bar.low ?? 0,
                close: bar.close ?? 0,
                volume: bar.volume ?? 0,
              },
            });
            upserted++;
          }
          break;
        }

        case 'dividends': {
          let divs: any[] = [];
          try {
            divs = await provider.fetchDividends(symbol, from, to);
          } catch (err) {
            if (sourceType === 'yahoo_finance') {
              console.warn(`[Ingestion] Yahoo Finance dividends failed for ${symbol}. Retrying with Python yfinance...`, String(err));
              const fallbackProvider = new YFinancePythonProvider();
              divs = await fallbackProvider.fetchDividends(symbol, from, to);
              currentSource = 'yfinance_python';
            } else {
              throw err;
            }
          }
          responsesLog.push({ symbol, count: divs.length, source: currentSource });

          for (const div of divs) {
            await prisma.dividend.create({
              data: {
                symbolCode: symbol,
                exDividendDate: new Date(div.date),
                dividendPerShare: parseFloat(div.amount) || 0,
                dividendType: 'unknown',
                rawJson: div as any,
              },
            });
            upserted++;
          }
          break;
        }

        case 'splits': {
          let splits: any[] = [];
          try {
            splits = await provider.fetchSplits(symbol, from, to);
          } catch (err) {
            if (sourceType === 'yahoo_finance') {
              console.warn(`[Ingestion] Yahoo Finance splits failed for ${symbol}. Retrying with Python yfinance...`, String(err));
              const fallbackProvider = new YFinancePythonProvider();
              splits = await fallbackProvider.fetchSplits(symbol, from, to);
              currentSource = 'yfinance_python';
            } else {
              throw err;
            }
          }
          responsesLog.push({ symbol, count: splits.length, source: currentSource });

          for (const split of splits) {
            let ratio = parseFloat(split.ratio);
            if (split.ratio.includes(':')) {
              const parts = split.ratio.split(':');
              const a = parseFloat(parts[0]);
              const b = parseFloat(parts[1]);
              if (a && b) ratio = a / b;
            }
            await prisma.corporateAction.create({
              data: {
                symbolCode: symbol,
                actionDate: new Date(split.date),
                actionType: 'split',
                splitRatio: ratio || 1,
                details: split as any,
              },
            });
            upserted++;
          }
          break;
        }

        case 'financial_statements': {
          let raw: any;
          try {
            raw = await provider.fetchFinancialStatements(symbol);
          } catch (err) {
            if (sourceType === 'yahoo_finance') {
              console.warn(`[Ingestion] Yahoo Finance financials failed for ${symbol}. Retrying with Python yfinance...`, String(err));
              const fallbackProvider = new YFinancePythonProvider();
              raw = await fallbackProvider.fetchFinancialStatements(symbol);
              currentSource = 'yfinance_python';
            } else {
              throw err;
            }
          }
          responsesLog.push({ symbol, status: 'fetched', source: currentSource });

          const results = currentSource === 'yahoo_finance' 
            ? mapYahooFinancials(raw, symbol)
            : mapYFinancePythonFinancials(raw, symbol);

          for (const row of results) {
            const announcedAt = new Date(row.announcedAt);
            const existing = await prisma.financialResult.findFirst({
              where: {
                symbolCode: row.symbolCode,
                fiscalPeriod: row.fiscalPeriod,
                announcedAt: {
                  gte: new Date(announcedAt.getTime() - 24 * 3600 * 1000),
                  lte: new Date(announcedAt.getTime() + 24 * 3600 * 1000),
                },
              },
            });
            if (!existing) {
              await prisma.financialResult.create({
                data: row,
              });
              upserted++;
            }
          }
          break;
        }

        case 'earnings_calendar': {
          let calendar: any;
          try {
            calendar = await provider.fetchEarningsCalendar(symbol);
          } catch (err) {
            if (sourceType === 'yahoo_finance') {
              console.warn(`[Ingestion] Yahoo Finance earnings calendar failed for ${symbol}. Retrying with Python yfinance...`, String(err));
              const fallbackProvider = new YFinancePythonProvider();
              calendar = await fallbackProvider.fetchEarningsCalendar(symbol);
              currentSource = 'yfinance_python';
            } else {
              throw err;
            }
          }
          responsesLog.push({ symbol, status: 'fetched', source: currentSource });

          const dates = calendar?.calendarEvents?.earnings?.earningsDate || [];
          for (const d of dates) {
            if (!d) continue;
            const scheduledAt = new Date(d);
            await prisma.earningsCalendar.upsert({
              where: { symbolCode_scheduledAt: { symbolCode: symbol, scheduledAt } },
              create: {
                symbolCode: symbol,
                scheduledAt,
                fiscalPeriod: 'unknown',
                source: currentSource,
                rawJson: calendar as any,
              },
              update: {},
            });
            upserted++;
          }
          break;
        }
      }
    } catch (err) {
      failed++;
      if (failureExamples.length < 5) {
        failureExamples.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Save Raw API Run result
  await saveRawApiSuccess(runId, endpoint, requestParams, responsesLog);

  if (upserted === 0 && failed > 0) {
    throw new Error(`${sourceType} ${datasetName} failed for all symbols. Examples: ${failureExamples.join('; ')}`);
  }

  return { count: upserted };
}

// JPX Ingestion
async function runJPXIngestion(runId: string): Promise<{ count: number }> {
  const provider = new JPXListedIssueProvider();
  const endpoint = 'jpx/listed_issue_master';
  
  try {
    const issues = await provider.importListedIssuesFromUrl(
      'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls'
    );
    
    await saveRawApiSuccess(runId, endpoint, {}, { count: issues.length });
    
    let upserted = 0;
    for (const issue of issues) {
      const existing = await prisma.symbol.findUnique({ where: { code: issue.code } });
      
      await prisma.symbol.upsert({
        where: { code: issue.code },
        create: {
          code: issue.code,
          name: issue.name,
          market: issue.market,
          sector: issue.sector,
          isActive: true,
        },
        update: {
          name: issue.name,
          market: issue.market,
          sector: issue.sector,
        },
      });
      
      await prisma.symbolMasterHistory.create({
        data: {
          symbolCode: issue.code,
          changeDate: new Date(),
          changeType: existing ? 'update' : 'create',
          oldValue: existing ? (existing as any) : null,
          newValue: issue as any,
          source: 'jpx',
        },
      });
      upserted++;
    }
    return { count: upserted };
  } catch (error) {
    await saveRawApiFailure(runId, endpoint, {}, error);
    throw error;
  }
}

// EDINET Ingestion
async function runEdinetIngestion(runId: string, targetDate: Date): Promise<{ count: number }> {
  const provider = createEdinetProvider();
  const endpoint = 'edinet/edinet_documents';
  const requestParams = { date: targetDate.toISOString().slice(0, 10) };
  
  try {
    const list = await provider.fetchDocumentList(targetDate);
    await saveRawApiSuccess(runId, endpoint, requestParams, list);

    // EDINET lists every filer (funds, foreign issuers, …); keep only documents
    // for symbols in our universe. secCode is 5-char (4-digit + check "0"); our
    // JPX codes are also 5-char, but try the 4-digit form as a fallback.
    const validCodes = new Set(
      (await prisma.symbol.findMany({ select: { code: true } })).map((s) => s.code),
    );
    const resolveCode = (secCode: string): string | null => {
      if (validCodes.has(secCode)) return secCode;
      const four = secCode.slice(0, 4);
      if (validCodes.has(four)) return four;
      return null;
    };

    let inserted = 0;
    for (const doc of list.results) {
      if (!doc.secCode) continue;
      const symbolCode = resolveCode(doc.secCode);
      if (!symbolCode) continue; // filer not in our tradable universe

      try {
        await prisma.disclosureDocument.create({
          data: {
            symbolCode,
            disclosureNumber: doc.docId,
            docId: doc.docId,
            source: 'edinet',
            docTypeCode: doc.docTypeCode,
            docType: provider.classifyEdinetDocument(doc.docTypeCode),
            title: doc.docDescription || 'EDINET Document',
            submittedAt: new Date(doc.submitDateTime),
            periodStart: doc.periodStart ? new Date(doc.periodStart) : null,
            periodEnd: doc.periodEnd ? new Date(doc.periodEnd) : null,
            pdfUrl: doc.pdfFlag === '1' ? `https://api.edinet-fsa.go.jp/api/v2/documents/${doc.docId}?type=2` : null,
            xbrlUrl: doc.xbrlFlag === '1' ? `https://api.edinet-fsa.go.jp/api/v2/documents/${doc.docId}?type=1` : null,
            rawMetaJson: doc as any,
          },
        });
        await prisma.disclosure.create({
          data: {
            symbolCode,
            disclosedAt: new Date(doc.submitDateTime),
            disclosureType: provider.classifyEdinetDocument(doc.docTypeCode),
            title: doc.docDescription || 'EDINET Document',
            summary: `${doc.filerName} が書類を提出しました。種類: ${doc.docDescription}`,
            rawJson: doc as any,
          },
        });
        inserted++;
      } catch {
        // duplicate docId or transient row issue — skip this document, keep going.
      }
    }
    return { count: inserted };
  } catch (error) {
    await saveRawApiFailure(runId, endpoint, requestParams, error);
    throw error;
  }
}
// TDnet Ingestion (Free Web API)
async function runFreeTDnetIngestion(runId: string, fromDate: Date, toDate: Date): Promise<{ count: number }> {
  const provider = createTDnetProvider();
  const endpoint = 'tdnet/free_disclosures';
  const requestParams = {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
  };

  try {
    const list = await provider.fetchDisclosureIndex(fromDate, toDate);
    
    let upserted = 0;
    const logResponses: any[] = [];

    for (const item of list) {
      // Check if DisclosureDocument already exists
      const existingDoc = await prisma.disclosureDocument.findFirst({
        where: {
          source: 'tdnet',
          disclosureNumber: item.disclosureNumber,
        }
      });

      if (!existingDoc) {
        // Create DisclosureDocument
        await prisma.disclosureDocument.create({
          data: {
            symbolCode: item.symbolCode,
            disclosureNumber: item.disclosureNumber,
            docId: item.disclosureNumber,
            source: 'tdnet',
            docTypeCode: item.category,
            docType: item.category,
            title: item.title,
            submittedAt: new Date(item.submittedAt),
            pdfUrl: item.pdfUrl || null,
            rawMetaJson: item as any,
          }
        });

        // Create Disclosure
        await prisma.disclosure.create({
          data: {
            symbolCode: item.symbolCode,
            disclosedAt: new Date(item.submittedAt),
            disclosureType: item.category,
            title: item.title,
            summary: `${item.companyName} が適時開示を提出しました。: ${item.title}`,
            rawJson: item as any,
          }
        });

        logResponses.push({ symbol: item.symbolCode, title: item.title });
        upserted++;
      }
    }

    await saveRawApiSuccess(runId, endpoint, requestParams, logResponses);
    return { count: upserted };
  } catch (error) {
    await saveRawApiFailure(runId, endpoint, requestParams, error);
    throw error;
  }
}


/**
 * Fetch and upsert the latest daily prices for all active symbols (Yahoo Finance
 * by default, yfinance-python if configured) and record a DataIngestionRun. Used
 * by the scheduler to keep market data fresh before each day's live trading, so
 * the full pipeline (ingest -> screen -> AI decide -> trade) runs unattended.
 */
export async function ingestDailyPrices(
  targetDate: Date = new Date(),
): Promise<{ count: number; runId: string }> {
  const sourceType: 'yahoo_finance' | 'yfinance_python' =
    process.env.MARKET_INGEST_SOURCE === 'yfinance_python' ? 'yfinance_python' : 'yahoo_finance';

  const dataSource = await prisma.dataSource.upsert({
    where: { sourceType },
    create: { sourceType, enabled: true },
    update: {},
  });
  const run = await prisma.dataIngestionRun.create({
    data: {
      dataSourceId: dataSource.id,
      datasetName: 'daily_prices',
      targetDate,
      status: 'running',
      startedAt: new Date(),
    },
  });

  try {
    const result = await runYahooOrPythonIngestion(
      run.id,
      sourceType,
      'daily_prices',
      targetDate,
      targetDate,
    );
    await prisma.dataIngestionRun.update({
      where: { id: run.id },
      data: { status: 'completed', finishedAt: new Date(), recordCount: result.count },
    });
    await prisma.dataSource.update({
      where: { id: dataSource.id },
      data: { lastFetchedAt: new Date(), lastFetchCount: result.count, lastError: null },
    });
    return { count: result.count, runId: run.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.dataIngestionRun.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), errorMessage: msg },
    });
    await prisma.dataSource.update({ where: { id: dataSource.id }, data: { lastError: msg } });
    throw err;
  }
}

/**
 * Fetch EDINET disclosure documents (有報・四半期報告書 等) for a date and store them
 * as Disclosure rows, which the strategy reads as `disclosureText` to flag
 * one-time-profit growth (earnings-quality filter). No-op unless EDINET_ENABLED.
 */
export async function ingestEdinetDisclosures(
  targetDate: Date = new Date(),
): Promise<{ count: number; runId: string } | null> {
  if (process.env.EDINET_ENABLED !== 'true') return null;
  const dataSource = await prisma.dataSource.upsert({
    where: { sourceType: 'edinet' },
    create: { sourceType: 'edinet', enabled: true },
    update: {},
  });
  const run = await prisma.dataIngestionRun.create({
    data: {
      dataSourceId: dataSource.id,
      datasetName: 'edinet_documents',
      targetDate,
      status: 'running',
      startedAt: new Date(),
    },
  });
  try {
    const result = await runEdinetIngestion(run.id, targetDate);
    await prisma.dataIngestionRun.update({
      where: { id: run.id },
      data: { status: 'completed', finishedAt: new Date(), recordCount: result.count },
    });
    await prisma.dataSource.update({
      where: { id: dataSource.id },
      data: { lastFetchedAt: new Date(), lastFetchCount: result.count, lastError: null },
    });
    return { count: result.count, runId: run.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.dataIngestionRun.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), errorMessage: msg },
    });
    await prisma.dataSource.update({ where: { id: dataSource.id }, data: { lastError: msg } });
    throw err;
  }
}

/**
 * Refresh financial statements for a specific set of symbols (e.g. the day's
 * screened candidates), not the whole universe. Earnings come quarterly, so this
 * keeps the relevant names fresh cheaply instead of re-pulling every symbol.
 */
export async function ingestFinancialsFor(symbols: string[]): Promise<{ count: number } | null> {
  if (symbols.length === 0) return null;
  const sourceType: 'yahoo_finance' | 'yfinance_python' =
    process.env.MARKET_INGEST_SOURCE === 'yfinance_python' ? 'yfinance_python' : 'yahoo_finance';
  const dataSource = await prisma.dataSource.upsert({
    where: { sourceType },
    create: { sourceType, enabled: true },
    update: {},
  });
  const run = await prisma.dataIngestionRun.create({
    data: { dataSourceId: dataSource.id, datasetName: 'financial_statements', status: 'running', startedAt: new Date() },
  });
  try {
    const result = await runYahooOrPythonIngestion(
      run.id,
      sourceType,
      'financial_statements',
      undefined,
      undefined,
      symbols,
    );
    await prisma.dataIngestionRun.update({
      where: { id: run.id },
      data: { status: 'completed', finishedAt: new Date(), recordCount: result.count },
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.dataIngestionRun.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), errorMessage: msg },
    });
    throw err;
  }
}

export async function dataIngestionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/data-ingestion/runs
  app.get<{ Querystring: { limit?: string; status?: string } }>(
    '/api/data-ingestion/runs',
    async (req) => {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const where = req.query.status ? { status: req.query.status as any } : {};
      return prisma.dataIngestionRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { dataSource: { select: { sourceType: true } } },
      });
    },
  );

  // GET /api/data-ingestion/runs/:id
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

  // POST /api/data-ingestion/runs
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
      where: { sourceType: sourceType as SourceType },
      create: { sourceType: sourceType as SourceType, enabled: true },
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

    setImmediate(async () => {
      try {
        let result: { count: number };
        const tDate = targetDate ? new Date(targetDate) : new Date();
        const fDate = fromDate ? new Date(fromDate) : undefined;
        const oDate = toDate ? new Date(toDate) : undefined;

        if (sourceType === 'jquants') {
          result = await runJQuantsIngestion(run.id, datasetName as DatasetName, tDate);
        } else if (sourceType === 'yahoo_finance' || sourceType === 'yfinance_python') {
          result = await runYahooOrPythonIngestion(
            run.id,
            sourceType as any,
            datasetName as YahooDatasetName,
            fDate,
            oDate || tDate,
          );
        } else if (sourceType === 'jpx') {
          result = await runJPXIngestion(run.id);
        } else if (sourceType === 'edinet') {
          result = await runEdinetIngestion(run.id, tDate);
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

  // POST /api/data-bootstrap/free (Data Bootstrap Implementation)
  app.post<{
    Body: {
      marketFilter?: string;
      maxSymbols?: number;
      fromDate?: string;
      toDate?: string;
      concurrencyLimit?: number;
      rateLimitMs?: number;
    };
  }>('/api/data-bootstrap/free', async (req, reply) => {
    const { marketFilter, maxSymbols = 10, fromDate, toDate } = req.body;
    
    // Execute asynchronously and return a status token or similar
    setImmediate(async () => {
      console.log(`[Bootstrap] Starting free bootstrap. Max Symbols: ${maxSymbols}`);
      
      const dataSource = await prisma.dataSource.upsert({
        where: { sourceType: 'jpx' },
        create: { sourceType: 'jpx', enabled: true },
        update: {},
      });

      const run = await prisma.dataIngestionRun.create({
        data: {
          dataSourceId: dataSource.id,
          datasetName: 'bootstrap_free',
          status: 'running',
          startedAt: new Date(),
        },
      });

      try {
        // Step 1: Import JPX issues
        const jpxResult = await runJPXIngestion(run.id);
        console.log(`[Bootstrap] JPX master imported. Upserted Symbols: ${jpxResult.count}`);

        // Ensure MARKET_INDEX_CODE (GROWTH_MOCK) exists in Symbol table for FK integrity
        await prisma.symbol.upsert({
          where: { code: 'GROWTH_MOCK' },
          create: {
            code: 'GROWTH_MOCK',
            name: 'Mid/Small Growth Index (mock)',
            market: 'INDEX',
            sector: 'Index',
            isActive: false,
            lotSize: 1,
          },
          update: {},
        });

        // Step 2: Fetch all target symbols
        const filter: any = { isActive: true };
        if (marketFilter) {
          filter.market = { contains: marketFilter };
        }
        const symbols = await prisma.symbol.findMany({
          where: filter,
          select: { code: true },
          take: maxSymbols,
        });

        // Configure env overrides for bootstrap run
        const targetCodes = [...symbols.map(s => s.code), 'GROWTH_MOCK'];
        process.env.YAHOO_FINANCE_SYMBOLS = targetCodes.join(',');

        const fDate = fromDate ? new Date(fromDate) : new Date(Date.now() - 30 * 24 * 3600 * 1000); // 30 days default
        const tDate = toDate ? new Date(toDate) : new Date();

        // Step 3: Fetch Yahoo Daily Prices
        const priceResult = await runYahooOrPythonIngestion(
          run.id,
          'yahoo_finance',
          'daily_prices',
          fDate,
          tDate,
        );
        console.log(`[Bootstrap] Yahoo daily prices fetched: ${priceResult.count}`);

        // Step 4: Fetch dividends
        try {
          await runYahooOrPythonIngestion(run.id, 'yahoo_finance', 'dividends', fDate, tDate);
        } catch (e) {
          console.warn('[Bootstrap] Dividends fetch failed, skipped:', String(e));
        }

        // Step 5: Fetch financial statements
        try {
          await runYahooOrPythonIngestion(run.id, 'yahoo_finance', 'financial_statements');
        } catch (e) {
          console.warn('[Bootstrap] Financials fetch failed, skipped:', String(e));
        }

        // Step 6: Fetch free TDnet Disclosures
        try {
          const tdnetResult = await runFreeTDnetIngestion(run.id, fDate, tDate);
          console.log(`[Bootstrap] Free TDnet disclosures fetched: ${tdnetResult.count}`);
        } catch (e) {
          console.warn('[Bootstrap] Free TDnet disclosures fetch failed, skipped:', String(e));
        }

        await prisma.dataIngestionRun.update({
          where: { id: run.id },
          data: { status: 'completed', finishedAt: new Date(), recordCount: priceResult.count },
        });
      } catch (err) {
        console.error('[Bootstrap] Failed:', String(err));
        await prisma.dataIngestionRun.update({
          where: { id: run.id },
          data: { status: 'failed', finishedAt: new Date(), errorMessage: String(err) },
        });
      }
    });

    return reply.code(202).send({ message: 'Free bootstrap started successfully' });
  });

  // GET /api/data-ingestion/datasets
  app.get('/api/data-ingestion/datasets', async () => {
    return {
      jquants: DATASET_NAMES,
      yahoo_finance: YAHOO_DATASET_NAMES,
      yfinance_python: YAHOO_DATASET_NAMES,
      jpx: ['listed_issue_master'],
      edinet: ['edinet_documents'],
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
    };
  });

  // POST /api/data-ingestion/csv-import
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
