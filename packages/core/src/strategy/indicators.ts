import type { DailyBar } from '../types/index.js';

/**
 * Technical indicators. All functions are pure and operate on an ascending
 * (oldest-first) array of daily bars. They never look at the future: the caller
 * is responsible for slicing bars to the "as of" date before calling.
 */

export function simpleMovingAverage(bars: DailyBar[], period: number): number | null {
  if (bars.length < period || period <= 0) return null;
  const window = bars.slice(bars.length - period);
  const sum = window.reduce((acc, b) => acc + b.close, 0);
  return sum / period;
}

export function sma25(bars: DailyBar[]): number | null {
  return simpleMovingAverage(bars, 25);
}

export function sma75(bars: DailyBar[]): number | null {
  return simpleMovingAverage(bars, 75);
}

/** Highest high over the trailing `period` trading days (default ~52 weeks). */
export function highestHigh(bars: DailyBar[], period = 250): number | null {
  if (bars.length === 0) return null;
  const window = bars.slice(Math.max(0, bars.length - period));
  return window.reduce((max, b) => Math.max(max, b.high), 0);
}

export function high52Week(bars: DailyBar[]): number | null {
  return highestHigh(bars, 250);
}

/** Percent distance of the latest close below the 52w high. 0 == at the high. */
export function distanceTo52wHighPct(bars: DailyBar[]): number | null {
  if (bars.length === 0) return null;
  const hh = high52Week(bars);
  const last = bars[bars.length - 1];
  if (hh === null || last === undefined || hh === 0) return null;
  return ((hh - last.close) / hh) * 100;
}

/** Ratio of the latest day's volume to the trailing 20-day average volume. */
export function volumeRatio20d(bars: DailyBar[]): number | null {
  if (bars.length < 21) return null;
  const last = bars[bars.length - 1];
  const prev20 = bars.slice(bars.length - 21, bars.length - 1);
  const avg = prev20.reduce((acc, b) => acc + b.volume, 0) / prev20.length;
  if (last === undefined || avg === 0) return null;
  return last.volume / avg;
}

/** Trailing 20-day average turnover (売買代金) in JPY. */
export function turnover20dAvgJpy(bars: DailyBar[]): number | null {
  if (bars.length < 20) return null;
  const window = bars.slice(bars.length - 20);
  return window.reduce((acc, b) => acc + b.turnoverValue, 0) / window.length;
}

/**
 * Post-earnings price reaction: the close-to-close return on / shortly after the
 * announcement date, plus the volume ratio on that day.
 */
export function postEarningsReaction(
  bars: DailyBar[],
  announcedDate: string,
): { postEarningsReturnPct: number; postEarningsVolumeRatio: number } | null {
  const idx = bars.findIndex((b) => b.date >= announcedDate);
  if (idx <= 0 || idx >= bars.length) return null;
  const before = bars[idx - 1];
  const after = bars[idx];
  if (!before || !after || before.close === 0) return null;
  const ret = ((after.close - before.close) / before.close) * 100;
  const ratio = volumeRatio20d(bars.slice(0, idx + 1));
  return {
    postEarningsReturnPct: ret,
    postEarningsVolumeRatio: ratio ?? 1,
  };
}

/** Business-day difference (counting bars) between two ISO dates within `bars`. */
export function tradingDaysSince(bars: DailyBar[], fromDate: string): number | null {
  const idx = bars.findIndex((b) => b.date >= fromDate);
  if (idx < 0) return null;
  return bars.length - 1 - idx;
}
