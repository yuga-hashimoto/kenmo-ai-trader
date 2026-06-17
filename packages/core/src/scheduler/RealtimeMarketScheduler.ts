import type { AgentTaskType, SchedulerConfig } from '../types/index.js';

export interface SessionEvent {
  /** ISO yyyy-mm-dd (JST) */
  date: string;
  /** HH:mm (JST) */
  time: string;
  eventType: AgentTaskType;
}

/** The realtime intraday session plan derived from SchedulerConfig. */
export function sessionPlan(config: SchedulerConfig): Array<{ time: string; eventType: AgentTaskType }> {
  return [
    { time: config.preMarketTime, eventType: 'prepare_watchlist' },
    { time: config.marketOpenTime, eventType: 'monitor_and_trade' },
    { time: '10:30', eventType: 'monitor_and_trade' },
    { time: config.lunchStartTime, eventType: 'pre_lunch_review' },
    { time: config.lunchEndTime, eventType: 'monitor_and_trade' },
    { time: '14:30', eventType: 'monitor_and_trade' },
    { time: '15:20', eventType: 'pre_close_review' },
    { time: config.afterCloseTime, eventType: 'after_close_analysis' },
  ];
}

const jstDateString = (d: Date): string =>
  new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

const jstMinutes = (d: Date): number => {
  const j = new Date(d.getTime() + 9 * 3600_000);
  return j.getUTCHours() * 60 + j.getUTCMinutes();
};

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Is `date` (JST yyyy-mm-dd) a weekday and not in the holiday set. */
export function isTradingDay(date: string, holidays: ReadonlySet<string> = new Set()): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(date);
}

export type SessionHandler = (event: SessionEvent) => void | Promise<void>;

/**
 * RealtimeMarketScheduler — fires HermesAgent task events at the configured JST
 * session times on trading days. This is the production-facing scheduler used by
 * paper (and, behind safety gates, live) operation. It uses real timers and never
 * places orders itself — it only emits events; a broker/handler reacts.
 */
export class RealtimeMarketScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private firedKeys = new Set<string>();

  constructor(
    private readonly config: SchedulerConfig,
    private readonly handler: SessionHandler,
    private readonly options: { holidays?: ReadonlySet<string>; now?: () => Date; pollMs?: number } = {},
  ) {}

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  /** Events scheduled for a given JST date (used for tests + introspection). */
  eventsForDate(date: string): SessionEvent[] {
    if (!isTradingDay(date, this.options.holidays)) return [];
    return sessionPlan(this.config).map((p) => ({ date, time: p.time, eventType: p.eventType }));
  }

  /** The next due event at or after `from` (real clock). */
  nextEvent(from: Date = this.now()): SessionEvent | null {
    for (let i = 0; i < 14; i++) {
      const day = new Date(from.getTime() + i * 86_400_000);
      const date = jstDateString(day);
      if (!isTradingDay(date, this.options.holidays)) continue;
      const cutoff = i === 0 ? jstMinutes(from) : -1;
      for (const p of sessionPlan(this.config)) {
        if (toMinutes(p.time) >= cutoff) return { date, time: p.time, eventType: p.eventType };
      }
    }
    return null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private loop(): void {
    if (!this.running) return;
    const now = this.now();
    const date = jstDateString(now);
    const nowMin = jstMinutes(now);
    if (isTradingDay(date, this.options.holidays)) {
      for (const p of sessionPlan(this.config)) {
        const key = `${date} ${p.time}`;
        if (!this.firedKeys.has(key) && toMinutes(p.time) <= nowMin) {
          this.firedKeys.add(key);
          void this.handler({ date, time: p.time, eventType: p.eventType });
        }
      }
    }
    this.timer = setTimeout(() => this.loop(), this.options.pollMs ?? 60_000);
  }
}
