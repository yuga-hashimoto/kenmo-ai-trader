import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@kenmo/db';
import { audit } from '../audit/index.js';

const STANCES = ['cautious', 'balanced', 'aggressive'] as const;

const postSchema = z.object({
  stance: z.enum(STANCES).default('balanced'),
  text: z.string().max(2000).default(''),
});

/**
 * Human → AI direction. The latest directive (stance + free-text notes) is the
 * active guidance injected into every live trading decision. Past directives are
 * kept so the user can see what they have told the AI over time.
 */
export async function guidanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/guidance', async () => {
    const [current, history] = await Promise.all([
      prisma.humanDirective.findFirst({ orderBy: { createdAt: 'desc' } }),
      prisma.humanDirective.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return { current, history };
  });

  app.post('/api/guidance', async (req, reply) => {
    const body = postSchema.parse(req.body);
    // Only the latest is "active"; supersede older ones for clarity.
    await prisma.humanDirective.updateMany({ where: { active: true }, data: { active: false } });
    const created = await prisma.humanDirective.create({
      data: { stance: body.stance, text: body.text.trim(), active: true },
    });
    await audit('user', 'guidance.set', 'HumanDirective', created.id, {
      stance: body.stance,
      text: body.text.slice(0, 200),
    });
    return reply.code(201).send(created);
  });
}
