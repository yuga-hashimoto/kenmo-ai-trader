/**
 * VirtualClock drives the event-driven backtest. It advances one trading day at
 * a time over a supplied list of trading dates, exposing the "current" date so
 * that AgentContext / MarketDataProvider can be sliced to avoid future leakage.
 */
export class VirtualClock {
  private index = -1;

  constructor(private readonly tradingDates: string[]) {}

  /** Advance to the next trading day. Returns false when the range is exhausted. */
  next(): boolean {
    if (this.index + 1 >= this.tradingDates.length) return false;
    this.index += 1;
    return true;
  }

  get currentDate(): string {
    const d = this.tradingDates[this.index];
    if (d === undefined) throw new Error('VirtualClock not started');
    return d;
  }

  get hasStarted(): boolean {
    return this.index >= 0;
  }

  get isFinished(): boolean {
    return this.index >= this.tradingDates.length - 1;
  }

  get progress(): { current: number; total: number } {
    return { current: this.index + 1, total: this.tradingDates.length };
  }

  reset(): void {
    this.index = -1;
  }
}

/** Filter trading dates to a [start, end] inclusive window (ISO yyyy-mm-dd). */
export function tradingDatesInRange(
  allDates: string[],
  startDate: string,
  endDate: string,
): string[] {
  return allDates
    .filter((d) => d >= startDate && d <= endDate)
    .sort((a, b) => a.localeCompare(b));
}
