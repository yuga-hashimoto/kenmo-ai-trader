import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@kenmo/db';
import { DEFAULT_STRATEGY_CONFIG } from '@kenmo/core';
import { audit } from '../audit/index.js';

const updateSchema = z.object({
  initialCapitalJpy: z.number().positive().optional(),
  allowMargin: z.boolean().optional(),
  defaultStrategyVersionId: z.string().nullable().optional(),
  tradingMode: z.enum(['backtest', 'paper', 'live']).optional(),
  liveTradingEnabled: z.boolean().optional(),
});

async function getOrCreateSetting() {
  let setting = await prisma.userSetting.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!setting) {
    setting = await prisma.userSetting.create({ data: {} });
  }
  return setting;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => {
    const setting = await getOrCreateSetting();
    return {
      ...setting,
      // surfaced read-only safety + risk info for the settings UI
      liveTradingPossible: process.env.ENABLE_LIVE_TRADING === 'true',
      hermesMode: process.env.HERMES_MODE ?? 'mock',
      riskDefaults: DEFAULT_STRATEGY_CONFIG.risk,
      universeDefaults: DEFAULT_STRATEGY_CONFIG.universe,
      schedulerDefaults: DEFAULT_STRATEGY_CONFIG.scheduler,
    };
  });

  app.put('/api/settings', async (req, reply) => {
    const body = updateSchema.parse(req.body);
    const setting = await getOrCreateSetting();

    // Safety gate: live mode can only be selected if the env flag is set.
    if (body.tradingMode === 'live' && process.env.ENABLE_LIVE_TRADING !== 'true') {
      return reply.code(403).send({
        error:
          'Live trading is disabled. Set ENABLE_LIVE_TRADING=true and complete the confirmation flow to enable.',
      });
    }
    if (body.liveTradingEnabled === true && process.env.ENABLE_LIVE_TRADING !== 'true') {
      return reply.code(403).send({ error: 'ENABLE_LIVE_TRADING env flag is required' });
    }

    const updated = await prisma.userSetting.update({
      where: { id: setting.id },
      data: body,
    });
    await audit('user', 'settings.updated', 'UserSetting', updated.id, body);
    return reply.send(updated);
  });
}
