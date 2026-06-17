import type { FastifyInstance } from 'fastify';
import { prisma } from '@kenmo/db';

type Actor = 'system' | 'user' | 'ai';

/** Append-only audit log helper. */
export async function audit(
  actor: Actor,
  action: string,
  targetType: string,
  targetId: string | null,
  payload?: unknown,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actor,
      action,
      targetType,
      targetId,
      payloadJson: (payload ?? null) as object,
    },
  });
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dashboard/audit-logs', async () => {
    return prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  });
}
