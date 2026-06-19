import type { FastifyInstance } from 'fastify';
import {
  buildDecisionJournal,
  DEFAULT_JOURNAL_PARAMS,
  type JournalParams,
} from '../../lib/decisionJournal.js';

/**
 * Strategy-tuning analysis endpoints. The decision journal joins every screened
 * buy/skip decision to its forward price action so thresholds can be tuned with
 * evidence ("which skip reasons cost the most upside", "do high scores win?").
 */
export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { horizons?: string; missThresholdPct?: string; scoreHorizon?: string };
  }>('/api/analysis/decision-journal', async (req) => {
    const q = req.query;
    const params: JournalParams = {
      horizons: q.horizons
        ? q.horizons.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
        : DEFAULT_JOURNAL_PARAMS.horizons,
      missThresholdPct: q.missThresholdPct ? Number(q.missThresholdPct) : DEFAULT_JOURNAL_PARAMS.missThresholdPct,
      scoreHorizon: q.scoreHorizon ? Number(q.scoreHorizon) : DEFAULT_JOURNAL_PARAMS.scoreHorizon,
    };
    if (params.horizons.length === 0) params.horizons = DEFAULT_JOURNAL_PARAMS.horizons;
    return buildDecisionJournal(params);
  });
}
