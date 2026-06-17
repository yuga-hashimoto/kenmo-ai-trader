import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';
import {
  RealtimeMarketScheduler,
  DEFAULT_STRATEGY_CONFIG,
  type SessionEvent,
} from '@kenmo/core';
import { audit } from '../audit/index.js';

let scheduler: RealtimeMarketScheduler | null = null;
let lastEvent: SessionEvent | null = null;

/**
 * Starts the RealtimeMarketScheduler when ENABLE_REALTIME_SCHEDULER=true. On each
 * JST session event it records a SchedulerEvent + AuditLog for every running
 * PaperRun, proving the live loop operates. (Incremental live paper order
 * processing hooks in here; it never touches a real broker.)
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
}
