import type { AgentTaskType } from '../types/index.js';

export interface VirtualEvent {
  virtualTime: string;
  eventType: AgentTaskType;
}

/**
 * The canonical intraday virtual schedule used by the BacktestVirtualScheduler.
 * MVP uses daily bars so the exact times are informational, but they are stored
 * on SchedulerEvent rows and shown in the UI to convey intent / ordering.
 */
export const VIRTUAL_DAY_SCHEDULE: VirtualEvent[] = [
  { virtualTime: '08:30', eventType: 'prepare_watchlist' },
  { virtualTime: '09:05', eventType: 'monitor_and_trade' },
  { virtualTime: '10:30', eventType: 'monitor_and_trade' },
  { virtualTime: '11:25', eventType: 'pre_lunch_review' },
  { virtualTime: '12:35', eventType: 'monitor_and_trade' },
  { virtualTime: '14:30', eventType: 'monitor_and_trade' },
  { virtualTime: '15:20', eventType: 'pre_close_review' },
  { virtualTime: '15:40', eventType: 'after_close_analysis' },
];

export interface ScheduledEventPlan {
  eventDate: string;
  virtualTime: string;
  eventType: AgentTaskType;
  sequence: number;
}

/** Expand a list of trading dates into an ordered list of virtual events. */
export function generateScheduleForDates(dates: string[]): ScheduledEventPlan[] {
  const plan: ScheduledEventPlan[] = [];
  let sequence = 0;
  for (const date of dates) {
    for (const ev of VIRTUAL_DAY_SCHEDULE) {
      plan.push({
        eventDate: date,
        virtualTime: ev.virtualTime,
        eventType: ev.eventType,
        sequence: sequence++,
      });
    }
  }
  return plan;
}

/** Build a JST ISO timestamp string from a date + HH:mm virtual time. */
export function toJstIso(date: string, virtualTime: string): string {
  return `${date}T${virtualTime}:00+09:00`;
}
