import { prisma } from '@kenmo/db';
import type { DailyBar } from '@kenmo/core';
import { loadMarketDataProvider } from './marketData.js';

/**
 * Decision journal with outcome answer-keys.
 *
 * Every day the AI screens ~400 candidates and explicitly decides buy / skip on
 * the top names. This module flattens those decisions and joins forward price
 * action (+N trading-day returns) so we can ask the questions that drive tuning:
 *   - Which SKIP reasons cost us the most upside (skipped → rallied)?
 *   - Do higher score / confidence buckets actually win more?
 *   - Which BUYS lost money, and what did they have in common?
 *
 * Output is plain JSON so it can be served over HTTP or dumped to a file and read
 * back by a human or an assistant tuning the strategy config. No broker touched.
 */

export interface JournalParams {
  /** Forward horizons (trading days) to measure outcome at. */
  horizons: number[];
  /** A skip "missed a winner" if its forward return at `missHorizon` ≥ this %. */
  missThresholdPct: number;
  /** Horizon (trading days) used for win-rate / missed-winner classification. */
  scoreHorizon: number;
}

export const DEFAULT_JOURNAL_PARAMS: JournalParams = {
  horizons: [5, 10, 20],
  missThresholdPct: 7,
  scoreHorizon: 10,
};

interface RawCandidate {
  symbol: string;
  name?: string;
  score?: number;
  baseScore?: number;
  strategy?: string;
  buyAllowed?: boolean;
  distanceTo52wHighPct?: number;
  advancedFilters?: { earningsQuality?: { score?: number } | null } | null;
}
interface RawDecision {
  symbol: string;
  decision: string;
  reason?: string;
  strategy?: string;
  confidence?: number | null;
  budgetJpy?: number | null;
  doNotBuyReasons?: string[];
}

export interface JournalRow {
  date: string;
  runType: string;
  runId: string | null;
  symbol: string;
  name: string;
  decision: string;
  strategy: string;
  score: number | null;
  confidence: number | null;
  buyAllowed: boolean | null;
  distanceTo52wHighPct: number | null;
  earningsQualityScore: number | null;
  reason: string;
  reasonCategory: string;
  doNotBuyReasons: string[];
  /** entryPrice → close on the decision date. */
  refPrice: number | null;
  /** forward % returns keyed by horizon, e.g. { "5": 1.2, "10": -3.4 }. */
  forwardReturnPct: Record<string, number | null>;
  /** convenience: true once the scoreHorizon return is known and positive. */
  scoreReturnPct: number | null;
}

const isoDay = (d: Date | string): string =>
  (typeof d === 'string' ? new Date(d) : d).toISOString().slice(0, 10);

/** Bucket a free-text reason so "スコア0 < 60" and "スコア5 < 60" group together. */
function reasonCategory(reason: string): string {
  return (reason || '理由なし')
    .replace(/^見送り[:：]\s*/, '')
    .replace(/-?\d+(\.\d+)?/g, 'N')
    .trim()
    .slice(0, 48);
}

function addCalendarDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Return the close on `date` (or the first trading day after it) plus the close `h` bars later. */
function forwardReturn(bars: DailyBar[], date: string, horizon: number): { ref: number | null; ret: number | null } {
  const idx = bars.findIndex((b) => isoDay(b.date) >= date);
  const entry = idx < 0 ? undefined : bars[idx];
  if (!entry) return { ref: null, ret: null };
  const ref = entry.close;
  const target = bars[idx + horizon];
  if (!ref || !target?.close) return { ref: ref ?? null, ret: null };
  return { ref, ret: ((target.close - ref) / ref) * 100 };
}

interface Aggregate {
  n: number;
  avgReturnPct: number | null;
  positiveRatePct: number | null;
}

function aggregate(values: Array<number | null>): Aggregate {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return { n: values.length, avgReturnPct: null, positiveRatePct: null };
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  const pos = known.filter((v) => v > 0).length;
  return {
    n: values.length,
    avgReturnPct: Number(avg.toFixed(2)),
    positiveRatePct: Number(((pos / known.length) * 100).toFixed(1)),
  };
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return m;
}

export interface DecisionJournal {
  generatedAt: string;
  params: JournalParams;
  rowCount: number;
  rows: JournalRow[];
  summary: {
    byDecision: Record<string, number>;
    buys: {
      total: Aggregate;
      byStrategy: Record<string, Aggregate>;
      byScoreBucket: Record<string, Aggregate>;
      byConfidenceBucket: Record<string, Aggregate>;
    };
    skips: {
      total: Aggregate;
      missedWinnerRatePct: number | null;
      /** Skip reasons ranked by how much upside they cost (highest avg forward return first). */
      byReason: Array<{ reason: string; n: number; missedWinners: number } & Aggregate>;
    };
  };
}

const scoreBucket = (s: number | null): string =>
  s === null ? '不明' : s >= 90 ? '90+' : s >= 80 ? '80-89' : s >= 70 ? '70-79' : s >= 60 ? '60-69' : '<60';
const confBucket = (c: number | null): string =>
  c === null ? '不明' : c >= 0.8 ? '0.80+' : c >= 0.7 ? '0.70-0.79' : c >= 0.6 ? '0.60-0.69' : '<0.60';

/** Build the outcome-joined decision journal across all paper/backtest agent runs. */
export async function buildDecisionJournal(
  params: JournalParams = DEFAULT_JOURNAL_PARAMS,
): Promise<DecisionJournal> {
  const runs = await prisma.agentRun.findMany({ orderBy: { createdAt: 'asc' } });
  const provider = await loadMarketDataProvider();

  // 1) Flatten every decision into a row (without forward returns yet).
  const draft: JournalRow[] = [];
  for (const run of runs) {
    const input = (run.inputJson ?? {}) as { candidates?: RawCandidate[] };
    const output = (run.outputJson ?? {}) as { decisions?: RawDecision[] };
    const candById = new Map((input.candidates ?? []).map((c) => [c.symbol, c]));
    const date = isoDay(run.createdAt);
    for (const d of output.decisions ?? []) {
      const c = candById.get(d.symbol);
      const reason = (d.reason ?? '').replace(/^見送り[:：]\s*/, '').trim();
      draft.push({
        date,
        runType: run.runType,
        runId: run.paperRunId ?? run.backtestRunId,
        symbol: d.symbol,
        name: c?.name ?? d.symbol,
        decision: d.decision,
        strategy: d.strategy ?? c?.strategy ?? 'unknown',
        score: c?.score ?? null,
        confidence: d.confidence ?? null,
        buyAllowed: c?.buyAllowed ?? null,
        distanceTo52wHighPct: c?.distanceTo52wHighPct ?? null,
        earningsQualityScore: c?.advancedFilters?.earningsQuality?.score ?? null,
        reason,
        reasonCategory: reasonCategory(reason || (d.doNotBuyReasons ?? [])[0] || ''),
        doNotBuyReasons: d.doNotBuyReasons ?? [],
        refPrice: null,
        forwardReturnPct: {},
        scoreReturnPct: null,
      });
    }
  }

  // 2) Join forward returns. One price fetch per symbol over the full window.
  if (draft.length > 0) {
    const dates = draft.map((r) => r.date).sort();
    const from = dates[0] ?? isoDay(new Date());
    const to = addCalendarDays(dates[dates.length - 1] ?? from, 60);
    const symbols = [...new Set(draft.map((r) => r.symbol))];
    const barsBySymbol = new Map<string, DailyBar[]>();
    await Promise.all(
      symbols.map(async (s) => {
        try {
          barsBySymbol.set(s, await provider.getDailyPrices(s, from, to));
        } catch {
          barsBySymbol.set(s, []);
        }
      }),
    );
    for (const row of draft) {
      const bars = barsBySymbol.get(row.symbol) ?? [];
      for (const h of params.horizons) {
        const { ref, ret } = forwardReturn(bars, row.date, h);
        if (row.refPrice === null) row.refPrice = ref;
        row.forwardReturnPct[String(h)] = ret === null ? null : Number(ret.toFixed(2));
      }
      row.scoreReturnPct = row.forwardReturnPct[String(params.scoreHorizon)] ?? null;
    }
  }

  // 3) Aggregate.
  const buys = draft.filter((r) => r.decision === 'buy');
  const skips = draft.filter((r) => r.decision === 'skip' || r.decision === 'hold');

  const byDecision: Record<string, number> = {};
  for (const r of draft) byDecision[r.decision] = (byDecision[r.decision] ?? 0) + 1;

  const aggMap = <T>(m: Map<string, T[]>, pick: (r: T) => number | null): Record<string, Aggregate> =>
    Object.fromEntries([...m].map(([k, rows]) => [k, aggregate(rows.map(pick))]));

  const missed = skips.filter((r) => (r.scoreReturnPct ?? -Infinity) >= params.missThresholdPct);
  const skipKnown = skips.filter((r) => r.scoreReturnPct !== null);

  const byReason = [...groupBy(skips, (r) => r.reasonCategory)]
    .map(([reason, rows]) => ({
      reason,
      ...aggregate(rows.map((r) => r.scoreReturnPct)),
      missedWinners: rows.filter((r) => (r.scoreReturnPct ?? -Infinity) >= params.missThresholdPct).length,
    }))
    .sort((a, b) => (b.avgReturnPct ?? -Infinity) - (a.avgReturnPct ?? -Infinity));

  return {
    generatedAt: new Date().toISOString(),
    params,
    rowCount: draft.length,
    rows: draft,
    summary: {
      byDecision,
      buys: {
        total: aggregate(buys.map((r) => r.scoreReturnPct)),
        byStrategy: aggMap(groupBy(buys, (r) => r.strategy), (r) => r.scoreReturnPct),
        byScoreBucket: aggMap(groupBy(buys, (r) => scoreBucket(r.score)), (r) => r.scoreReturnPct),
        byConfidenceBucket: aggMap(groupBy(buys, (r) => confBucket(r.confidence)), (r) => r.scoreReturnPct),
      },
      skips: {
        total: aggregate(skips.map((r) => r.scoreReturnPct)),
        missedWinnerRatePct:
          skipKnown.length > 0 ? Number(((missed.length / skipKnown.length) * 100).toFixed(1)) : null,
        byReason,
      },
    },
  };
}
