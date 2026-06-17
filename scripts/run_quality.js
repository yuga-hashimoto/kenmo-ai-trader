import { prisma } from '@kenmo/db';
import { DataQualityService } from '@kenmo/core';

async function main() {
  console.log('Running Data Quality Checks...');

  try {
    const symbols = await prisma.symbol.findMany();
    const prices = await prisma.dailyPrice.findMany();
    const financials = await prisma.financialResult.findMany();
    const disclosures = await prisma.disclosure.findMany();

    // Create unique trading dates array
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
        guidanceRevision: f.guidanceRevision,
        rawJson: f.rawJson,
      })),
      disclosures: disclosures.map((d) => ({
        symbolCode: d.symbolCode,
        disclosedAt: d.disclosedAt.toISOString().slice(0, 10),
        disclosureType: d.disclosureType,
        title: d.title,
        summary: d.summary,
        rawText: d.rawText ?? '',
        rawJson: d.rawJson,
      })),
      tradingDates,
    });

    console.log(`Quality check completed at: ${report.checkedAt}`);
    console.log(`Total Issues found: ${report.totalIssues}`);
    console.log(`Errors: ${report.errors}`);
    console.log(`Warnings: ${report.warnings}`);

    if (report.issues.length > 0) {
      console.log('\n--- Details of Issues ---');
      for (const issue of report.issues) {
        const severityIndicator = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`${severityIndicator} [${issue.checkName}] ${issue.symbolCode ? `Symbol: ${issue.symbolCode}` : ''} ${issue.date ? `Date: ${issue.date}` : ''} - ${issue.message}`);
      }
    }

    if (report.errors > 0) {
      process.exit(1);
    }
  } catch (e) {
    console.error('Error during data quality check:', String(e));
    process.exit(1);
  }
}

main();
