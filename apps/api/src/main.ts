import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { backtestRoutes } from './modules/backtest/index.js';
import { paperRoutes } from './modules/paper/index.js';
import { strategyRoutes } from './modules/strategy/index.js';
import { evolutionRoutes } from './modules/evolution/index.js';
import { settingsRoutes } from './modules/settings/index.js';
import { marketDataRoutes } from './modules/market-data/index.js';
import { dashboardRoutes } from './modules/dashboard/index.js';
import { auditRoutes } from './modules/audit/index.js';
import { schedulerRoutes, startRealtimeScheduler } from './modules/scheduler/index.js';
import { ablationRoutes } from './modules/ablation/index.js';
import { dataSourceRoutes } from './modules/data-sources/index.js';
import { dataIngestionRoutes } from './modules/data-ingestion/index.js';
import { dataQualityRoutes } from './modules/data-quality/index.js';

async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Tolerate empty-body POSTs (e.g. /run, /start, /promote) sent with an
  // application/json content-type — treat them as an empty object.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = typeof body === 'string' ? body.trim() : '';
      if (text === '') {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err instanceof Error ? err : new Error('invalid json'), undefined);
      }
    },
  );

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_error', details: error.flatten() });
    }
    app.log.error(error);
    const message = error instanceof Error ? error.message : 'internal_error';
    return reply.code(500).send({ error: message });
  });

  app.get('/health', async () => ({ status: 'ok', tradingMode: 'backtest|paper (live disabled)' }));

  await app.register(backtestRoutes);
  await app.register(paperRoutes);
  await app.register(strategyRoutes);
  await app.register(evolutionRoutes);
  await app.register(settingsRoutes);
  await app.register(marketDataRoutes);
  await app.register(dashboardRoutes);
  await app.register(auditRoutes);
  await app.register(schedulerRoutes);
  await app.register(ablationRoutes);
  await app.register(dataSourceRoutes);
  await app.register(dataIngestionRoutes);
  await app.register(dataQualityRoutes);

  startRealtimeScheduler(app);

  return app;
}

const port = Number(process.env.API_PORT ?? 4000);
buildServer()
  .then((app) => app.listen({ port, host: '0.0.0.0' }))
  .then((addr) => {
    // eslint-disable-next-line no-console
    console.log(`kenmo-ai-trader API listening on ${addr}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
