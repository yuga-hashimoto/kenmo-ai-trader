import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';
import {
  RealtimeMarketScheduler,
  DEFAULT_STRATEGY_CONFIG,
  type SessionEvent,
} from '@kenmo/core';
import { audit } from '../audit/index.js';
import { catchUpRun } from '../../lib/liveTrading.js';
import { ingestDailyPrices } from '../data-ingestion/index.js';

let scheduler: RealtimeMarketScheduler | null = null;
let lastEvent: SessionEvent | null = null;

/** Session events after which the day's market data is final enough to trade on. */
const TRADE_TRIGGER_EVENTS = new Set(['after_close_analysis']);

/**
 * Drive live paper trading for every running run when a trading day closes. Each
 * run is advanced through all unprocessed market-data days (reconstruct portfolio
 * → run the day's AI sessions → append orders/fills/positions/snapshot). Runs in
 * the background with a per-run guard so a slow AI provider can't stall the loop.
 * Never touches a real broker.
 */
function triggerLiveTrading(app: FastifyInstance, event: SessionEvent): void {
  if (!TRADE_TRIGGER_EVENTS.has(event.eventType)) return;
  void (async () => {
    const runningPaper = await prisma.paperRun.findMany({ where: { status: 'running' } });
    if (runningPaper.length === 0) return;

    // 1) Refresh today's market data (close is final after the session) so the
    //    trading step has fresh bars to screen and trade on.
    if (process.env.ENABLE_AUTO_INGESTION !== 'false') {
      try {
        const { count } = await ingestDailyPrices(new Date(`${event.date}T00:00:00+09:00`));
        app.log.info({ date: event.date, count }, 'daily prices ingested');
        await audit('system', 'ingestion.daily_prices', 'DataIngestionRun', null, {
          date: event.date,
          count,
        });
      } catch (err) {
        app.log.error({ err }, 'daily price ingestion failed; trading on existing data');
      }
    }

    // 2) Advance each running run (single-flight per run).
    for (const run of runningPaper) {
      void catchUpRun(run.id)
        .then((steps) => {
          if (steps.length > 0) {
            app.log.info({ runId: run.id, days: steps.length }, 'live trading advanced');
          }
        })
        .catch((err) => app.log.error({ runId: run.id, err }, 'live trading step failed'));
    }
  })();
}

/**
 * Starts the RealtimeMarketScheduler when ENABLE_REALTIME_SCHEDULER=true. On each
 * JST session event it records a SchedulerEvent heartbeat for every running
 * PaperRun, and at end-of-day it advances live paper trading. Never touches a
 * real broker.
 */
export function startRealtimeScheduler(app: FastifyInstance): void {
  if (process.env.ENABLE_REALTIME_SCHEDULER !== 'true') return;

  scheduler = new RealtimeMarketScheduler(
    DEFAULT_STRATEGY_CONFIG.scheduler,
    async (event) => {
      lastEvent = event;
      app.log.info({ event }, 'realtime session event fired');
      const runningPaper = await prisma.paperRun.findMany({ where: { status: 'running' } });
      for (const run of runningPaper) {
        await prisma.schedulerEvent.create({
          data: {
            runType: 'paper',
            paperRunId: run.id,
            eventDate: new Date(`${event.date}T00:00:00Z`),
            virtualTime: event.time,
            eventType: event.eventType,
            status: 'completed',
          },
        });
      }
      if (runningPaper.length > 0) {
        await audit('system', 'scheduler.session_event', 'PaperRun', null, event);
      }
      triggerLiveTrading(app, event);
    },
    { pollMs: Number(process.env.SCHEDULER_POLL_MS ?? 60_000) },
  );
  scheduler.start();
  app.log.info('RealtimeMarketScheduler started');
}

export async function schedulerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/scheduler/status', async () => ({
    enabled: process.env.ENABLE_REALTIME_SCHEDULER === 'true',
    running: scheduler?.isRunning ?? false,
    lastEvent,
    nextEvent: scheduler?.nextEvent() ?? null,
  }));

  // Manually run the full daily cycle now (ingest latest prices -> trade every
  // running paper run). Same path the end-of-day scheduler fires, for testing or
  // catching up off-hours. Ingestion is awaited; trading runs in the background.
  app.post<{ Body?: { date?: string; skipIngest?: boolean } }>(
    '/api/scheduler/run-now',
    async (req, reply) => {
      const date = req.body?.date ?? new Date().toISOString().slice(0, 10);
      let ingested: { count: number; runId: string } | null = null;
      if (!req.body?.skipIngest && process.env.ENABLE_AUTO_INGESTION !== 'false') {
        try {
          ingested = await ingestDailyPrices(new Date(`${date}T00:00:00+09:00`));
        } catch (err) {
          app.log.error({ err }, 'run-now ingestion failed');
        }
      }
      const runningPaper = await prisma.paperRun.findMany({ where: { status: 'running' } });
      for (const run of runningPaper) {
        void catchUpRun(run.id).catch((err) =>
          app.log.error({ runId: run.id, err }, 'run-now trading failed'),
        );
      }
      return reply.send({
        date,
        ingested,
        runsTriggered: runningPaper.map((r) => r.id),
        message: 'ingestion done; trading running in background',
      });
    },
  );
}
