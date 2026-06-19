import { prisma } from '@kenmo/db';
import { generateDiverseChallengers, type StrategyConfig } from '@kenmo/core';
import { parseStrategyConfig } from './config.js';
import { seedBaselineAtLatest } from './liveTrading.js';
import { audit } from '../modules/audit/index.js';

/**
 * Champion / Challenger league: keep exactly 1 champion + LEAGUE_SIZE challengers
 * competing as virtual (paper) portfolios. Each strategy version trades by its own
 * config (catchUpRun reads the run's strategyVersion), and the 15:40 scheduler
 * advances every running paper run — so challengers trade automatically once seeded.
 *
 * Periodically (TOURNAMENT_INTERVAL_DAYS) the league ranks everyone by risk-adjusted
 * return, promotes a clearly-better challenger to champion (demoting the old champion
 * so it keeps competing), retires weak challengers, and regenerates fresh challengers
 * mutated from the *current* champion. Never touches a real broker.
 */

export const LEAGUE_SIZE = 5;
export const TOURNAMENT_INTERVAL_DAYS = 20;
export const FITNESS_WINDOW_DAYS = 20;
export const MIN_TRADES_FOR_EVAL = 3;
const DEFAULT_CAPITAL_JPY = 1_000_000;

export interface RunFitness {
  paperRunId: string;
  strategyVersionId: string;
  strategyName: string;
  leagueRole: string;
  trailingReturnPct: number | null;
  maxDrawdownPct: number | null;
  tradeCount: number;
  fitness: number | null;
  eligible: boolean;
}

async function getChampion() {
  return prisma.strategyVersion.findFirst({ where: { status: 'champion' } });
}

/** Capital/margin for new league runs — mirror an existing league/manual run, else defaults. */
async function leagueRunDefaults(): Promise<{ initialCapitalJpy: number; allowMargin: boolean }> {
  const ref = await prisma.paperRun.findFirst({ orderBy: { createdAt: 'asc' } });
  return {
    initialCapitalJpy: ref?.initialCapitalJpy ?? DEFAULT_CAPITAL_JPY,
    allowMargin: ref?.allowMargin ?? true,
  };
}

async function createLeagueRun(
  strategyVersionId: string,
  leagueRole: 'champion' | 'challenger',
  name: string,
): Promise<string> {
  const { initialCapitalJpy, allowMargin } = await leagueRunDefaults();
  const run = await prisma.paperRun.create({
    data: { name, initialCapitalJpy, allowMargin, strategyVersionId, leagueRole, status: 'running' },
  });
  await seedBaselineAtLatest(run.id);
  return run.id;
}

/**
 * Ensure exactly one running league run carries the champion. Prefers an existing
 * running run already on the champion strategy (so the user's history/continuity is
 * kept) and the one with the most snapshots; collapses any duplicate champion runs.
 */
async function ensureChampionRun(championId: string): Promise<void> {
  const candidates = await prisma.paperRun.findMany({
    where: {
      status: 'running',
      OR: [{ leagueRole: 'champion' }, { strategyVersionId: championId }],
    },
    include: { _count: { select: { snapshots: true } } },
  });

  if (candidates.length === 0) {
    await createLeagueRun(championId, 'champion', 'Champion（リーグ）');
    return;
  }

  // Pick the richest-history run as the canonical champion run.
  const chosen = [...candidates].sort((a, b) => b._count.snapshots - a._count.snapshots)[0]!;
  await prisma.paperRun.update({
    where: { id: chosen.id },
    data: { leagueRole: 'champion', strategyVersionId: championId },
  });

  // Demote any other champion-tagged runs. Empty baseline-only duplicates (e.g. an
  // auto-created stray) are stopped; runs with real history revert to manual.
  for (const c of candidates) {
    if (c.id === chosen.id) continue;
    if (c.leagueRole !== 'champion') continue;
    await prisma.paperRun.update({
      where: { id: c.id },
      data:
        c._count.snapshots <= 1
          ? { status: 'stopped', stoppedAt: new Date(), leagueRole: null }
          : { leagueRole: null },
    });
  }
}

/**
 * Self-heal the league to 1 champion + LEAGUE_SIZE running challengers. Missing
 * challengers are generated as diverse mutations of the current champion.
 */
export async function seedLeague(): Promise<{ champion: string; challengersAdded: number }> {
  const champion = await getChampion();
  if (!champion) throw new Error('no champion strategy; run db seed first');

  await ensureChampionRun(champion.id);

  const activeChallengerRuns = await prisma.paperRun.findMany({
    where: { leagueRole: 'challenger', status: 'running' },
    include: { strategyVersion: true },
  });
  const need = LEAGUE_SIZE - activeChallengerRuns.length;
  if (need <= 0) return { champion: champion.id, challengersAdded: 0 };

  const championConfig = parseStrategyConfig(champion.configJson);
  const existingConfigs: StrategyConfig[] = activeChallengerRuns.map((r) =>
    parseStrategyConfig(r.strategyVersion.configJson),
  );
  const newConfigs = generateDiverseChallengers(championConfig, need, existingConfigs);

  let added = 0;
  for (const cfg of newConfigs) {
    const sv = await prisma.strategyVersion.create({
      data: {
        name: `${champion.name}-c${Date.now().toString(36).slice(-4)}${added}`,
        parentVersionId: champion.id,
        status: 'challenger',
        configJson: cfg as unknown as object,
        promptVersion: champion.promptVersion,
        createdBy: 'ai',
        createdReason: 'league: mutated from champion',
      },
    });
    await createLeagueRun(sv.id, 'challenger', `Challenger ${sv.name}`);
    added++;
  }
  await audit('system', 'league.seeded', 'StrategyVersion', champion.id, { challengersAdded: added });
  return { champion: champion.id, challengersAdded: added };
}

/** Risk-adjusted fitness over the trailing window: return ÷ (maxDrawdown + 1). */
export async function computeFitness(paperRunId: string): Promise<Omit<RunFitness, 'strategyName' | 'leagueRole' | 'strategyVersionId'>> {
  const snaps = await prisma.portfolioSnapshot.findMany({
    where: { paperRunId },
    orderBy: { snapshotDate: 'desc' },
    take: FITNESS_WINDOW_DAYS,
  });
  if (snaps.length < 2) {
    return { paperRunId, trailingReturnPct: null, maxDrawdownPct: null, tradeCount: 0, fitness: null, eligible: false };
  }
  const ordered = [...snaps].reverse();
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const trailingReturnPct = first.equityJpy > 0 ? ((last.equityJpy - first.equityJpy) / first.equityJpy) * 100 : 0;
  const maxDrawdownPct = Math.max(...ordered.map((s) => s.drawdownPct));
  const tradeCount = await prisma.tradeEpisode.count({
    where: { paperRunId, exitDate: { gte: first.snapshotDate } },
  });
  const fitness = trailingReturnPct / (maxDrawdownPct + 1);
  return {
    paperRunId,
    trailingReturnPct: Number(trailingReturnPct.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    tradeCount,
    fitness: Number(fitness.toFixed(3)),
    eligible: tradeCount >= MIN_TRADES_FOR_EVAL,
  };
}

/** Fitness for every league run (champion + challengers), ranked best-first (eligible first). */
export async function rankLeague(): Promise<RunFitness[]> {
  const runs = await prisma.paperRun.findMany({
    where: { leagueRole: { in: ['champion', 'challenger'] }, status: 'running' },
    include: { strategyVersion: true },
  });
  const rows: RunFitness[] = [];
  for (const run of runs) {
    const f = await computeFitness(run.id);
    rows.push({
      ...f,
      strategyVersionId: run.strategyVersionId,
      strategyName: run.strategyVersion.name,
      leagueRole: run.leagueRole ?? 'challenger',
    });
  }
  return rows.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return (b.fitness ?? -Infinity) - (a.fitness ?? -Infinity);
  });
}

interface TournamentResult {
  ranked: RunFitness[];
  promoted: { from: string; to: string } | null;
  retired: string[];
  challengersAdded: number;
}

/** Promote the best challenger only if it clearly beats the champion on a fair sample. */
function shouldPromote(champion: RunFitness | undefined, best: RunFitness | undefined): boolean {
  if (!champion || !best || !best.eligible) return false;
  if (best.fitness === null || champion.fitness === null) return false;
  return (
    best.fitness > champion.fitness &&
    (best.trailingReturnPct ?? -Infinity) > (champion.trailingReturnPct ?? -Infinity) &&
    (best.maxDrawdownPct ?? 0) <= (champion.maxDrawdownPct ?? 0) + 5
  );
}

/** Evaluate the league: rank, (maybe) swap champion, retire weak challengers, refill to LEAGUE_SIZE. */
export async function runTournament(): Promise<TournamentResult> {
  await seedLeague();
  let ranked = await rankLeague();

  const champion = ranked.find((r) => r.leagueRole === 'champion');
  const challengers = ranked.filter((r) => r.leagueRole === 'challenger');
  const best = challengers.find((r) => r.eligible);

  let promoted: TournamentResult['promoted'] = null;
  if (champion && best && shouldPromote(champion, best)) {
    await prisma.$transaction([
      // Old champion → challenger (keeps competing), winner → champion.
      prisma.strategyVersion.update({ where: { id: champion.strategyVersionId }, data: { status: 'challenger' } }),
      prisma.strategyVersion.update({ where: { id: best.strategyVersionId }, data: { status: 'champion' } }),
      prisma.paperRun.update({ where: { id: champion.paperRunId }, data: { leagueRole: 'challenger' } }),
      prisma.paperRun.update({ where: { id: best.paperRunId }, data: { leagueRole: 'champion' } }),
    ]);
    promoted = { from: champion.strategyName, to: best.strategyName };
    await audit('system', 'league.promoted', 'StrategyVersion', best.strategyVersionId, promoted);
  }

  // Retire eligible challengers that are losing money risk-adjusted and ranked at the bottom.
  ranked = await rankLeague();
  const retireable = ranked
    .filter((r) => r.leagueRole === 'challenger' && r.eligible && (r.fitness ?? 0) < 0)
    .sort((a, b) => (a.fitness ?? 0) - (b.fitness ?? 0))
    .slice(0, 2); // at most 2 per tournament
  const retired: string[] = [];
  for (const r of retireable) {
    await prisma.$transaction([
      prisma.strategyVersion.update({ where: { id: r.strategyVersionId }, data: { status: 'archived' } }),
      prisma.paperRun.update({ where: { id: r.paperRunId }, data: { status: 'stopped', stoppedAt: new Date() } }),
    ]);
    retired.push(r.strategyName);
    await audit('system', 'league.retired', 'StrategyVersion', r.strategyVersionId, { fitness: r.fitness });
  }

  const { challengersAdded } = await seedLeague(); // refill from current champion
  return { ranked: await rankLeague(), promoted, retired, challengersAdded };
}

/** Trading days observed since the last tournament (distinct after-close session dates). */
async function tradingDaysSinceLastTournament(): Promise<number> {
  const last = await prisma.auditLog.findFirst({
    where: { action: 'league.tournament' },
    orderBy: { createdAt: 'desc' },
  });
  const events = await prisma.schedulerEvent.findMany({
    where: {
      eventType: 'after_close_analysis',
      ...(last ? { createdAt: { gt: last.createdAt } } : {}),
    },
    select: { eventDate: true },
  });
  return new Set(events.map((e) => e.eventDate.toISOString().slice(0, 10))).size;
}

export async function shouldRunTournament(): Promise<boolean> {
  return (await tradingDaysSinceLastTournament()) >= TOURNAMENT_INTERVAL_DAYS;
}

/** Run the periodic tournament if the interval has elapsed; records a marker either way it runs. */
export async function maybeRunTournament(): Promise<TournamentResult | null> {
  if (!(await shouldRunTournament())) return null;
  const result = await runTournament();
  await audit('system', 'league.tournament', 'StrategyVersion', null, {
    promoted: result.promoted,
    retired: result.retired,
  });
  return result;
}

export interface LeagueStatus {
  size: number;
  nextTournamentInDays: number;
  members: Array<RunFitness & { rank: number; createdAt: string; createdReason: string | null }>;
}

export async function getLeagueStatus(): Promise<LeagueStatus> {
  const ranked = await rankLeague();
  const svs = await prisma.strategyVersion.findMany({
    where: { id: { in: ranked.map((r) => r.strategyVersionId) } },
    select: { id: true, createdAt: true, createdReason: true },
  });
  const meta = new Map(svs.map((s) => [s.id, s]));
  const days = await tradingDaysSinceLastTournament();
  return {
    size: ranked.length,
    nextTournamentInDays: Math.max(0, TOURNAMENT_INTERVAL_DAYS - days),
    members: ranked.map((r, i) => ({
      ...r,
      rank: i + 1,
      createdAt: meta.get(r.strategyVersionId)?.createdAt.toISOString() ?? '',
      createdReason: meta.get(r.strategyVersionId)?.createdReason ?? null,
    })),
  };
}
