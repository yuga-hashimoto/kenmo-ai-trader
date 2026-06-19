import type { FastifyInstance } from 'fastify';
import { getLeagueStatus, seedLeague, runTournament } from '../../lib/league.js';

/**
 * Champion / Challenger league endpoints. Seeding and tournaments are also driven
 * automatically by the scheduler; these allow inspection and manual triggering.
 */
export async function leagueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/league', async () => getLeagueStatus());

  app.post('/api/league/seed', async () => {
    const result = await seedLeague();
    return { ...result, status: await getLeagueStatus() };
  });

  app.post('/api/league/tournament', async () => {
    const result = await runTournament();
    return result;
  });
}
