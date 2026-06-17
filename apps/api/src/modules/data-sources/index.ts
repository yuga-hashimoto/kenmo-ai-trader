import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';

const SOURCE_TYPES = ['jquants', 'tdnet', 'edinet', 'kabu_station', 'csv', 'seed'] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

function getSourceStatus(sourceType: SourceType) {
  const env = process.env;
  switch (sourceType) {
    case 'jquants':
      return {
        hasCredentials:
          !!(env.JQUANTS_EMAIL && env.JQUANTS_PASSWORD) ||
          !!env.JQUANTS_REFRESH_TOKEN ||
          !!env.JQUANTS_ID_TOKEN,
        plan: env.JQUANTS_PLAN ?? 'free',
        addonsEnabled: env.JQUANTS_ENABLE_ADDONS === 'true',
        baseUrl: env.JQUANTS_BASE_URL ?? 'https://api.jquants.com/v1',
      };
    case 'tdnet':
      return {
        enabled: env.TDNET_ENABLED === 'true',
        hasApiKey: !!env.TDNET_API_KEY,
        baseUrl: env.TDNET_API_BASE_URL ?? '',
      };
    case 'edinet':
      return {
        enabled: env.EDINET_ENABLED === 'true',
        hasApiKey: !!env.EDINET_API_KEY,
      };
    case 'kabu_station':
      return {
        enabled: env.KABU_STATION_ENABLED === 'true',
        hasPassword: !!env.KABU_STATION_PASSWORD,
        baseUrl: env.KABU_STATION_API_BASE_URL ?? 'http://localhost:18080/kabusapi',
        note: '価格・板照会のみ。本番発注は無効。',
      };
    case 'csv':
      return { alwaysAvailable: true };
    case 'seed':
      return { alwaysAvailable: true };
    default:
      return {};
  }
}

export async function dataSourceRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/data-sources — list all data sources with env status
  app.get('/api/data-sources', async () => {
    const dbSources = await prisma.dataSource.findMany({ orderBy: { sourceType: 'asc' } });
    const dbMap = new Map(dbSources.map((s) => [s.sourceType, s]));

    return SOURCE_TYPES.map((type) => {
      const db = dbMap.get(type);
      return {
        sourceType: type,
        enabled: db?.enabled ?? false,
        lastFetchedAt: db?.lastFetchedAt ?? null,
        lastFetchCount: db?.lastFetchCount ?? null,
        lastError: db?.lastError ?? null,
        updatedAt: db?.updatedAt ?? null,
        envStatus: getSourceStatus(type),
      };
    });
  });

  // GET /api/data-sources/:type — single source
  app.get<{ Params: { type: string } }>('/api/data-sources/:type', async (req, reply) => {
    const sourceType = req.params.type;
    if (!SOURCE_TYPES.includes(sourceType as SourceType)) {
      return reply.code(400).send({ error: 'invalid source type' });
    }
    const db = await prisma.dataSource.findUnique({
      where: { sourceType: sourceType as SourceType },
      include: { ingestionRuns: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    return {
      sourceType,
      enabled: db?.enabled ?? false,
      lastFetchedAt: db?.lastFetchedAt ?? null,
      lastFetchCount: db?.lastFetchCount ?? null,
      lastError: db?.lastError ?? null,
      envStatus: getSourceStatus(sourceType as SourceType),
      recentRuns: db?.ingestionRuns ?? [],
    };
  });

  // PUT /api/data-sources/:type — enable/disable
  app.put<{ Params: { type: string }; Body: { enabled?: boolean } }>(
    '/api/data-sources/:type',
    async (req, reply) => {
      const sourceType = req.params.type;
      if (!SOURCE_TYPES.includes(sourceType as SourceType)) {
        return reply.code(400).send({ error: 'invalid source type' });
      }
      const src = await prisma.dataSource.upsert({
        where: { sourceType: sourceType as SourceType },
        create: {
          sourceType: sourceType as SourceType,
          enabled: req.body.enabled ?? false,
        },
        update: {
          enabled: req.body.enabled ?? false,
        },
      });
      return src;
    },
  );
}
