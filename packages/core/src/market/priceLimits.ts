/**
 * 日本株の値幅制限（ストップ高/ストップ安）。前日終値に応じた制限値幅テーブル（TSE準拠の代表値）。
 * 完全な実運用テーブルではないが、バックテストでストップ高張り付き時に買えない／ストップ安で売れない
 * といった現実的制約を再現するのに十分な近似を提供する。将来、正式テーブルへ差し替え可能。
 */
const LIMIT_TABLE: Array<{ below: number; width: number }> = [
  { below: 100, width: 30 },
  { below: 200, width: 50 },
  { below: 500, width: 80 },
  { below: 700, width: 100 },
  { below: 1000, width: 150 },
  { below: 1500, width: 300 },
  { below: 2000, width: 400 },
  { below: 3000, width: 500 },
  { below: 5000, width: 700 },
  { below: 7000, width: 1000 },
  { below: 10000, width: 1500 },
  { below: 15000, width: 3000 },
  { below: 20000, width: 4000 },
  { below: 30000, width: 5000 },
  { below: 50000, width: 7000 },
  { below: 70000, width: 10000 },
  { below: 100000, width: 15000 },
];

/** Daily price-limit width (±) given the previous close. */
export function priceLimitWidth(prevClose: number): number {
  for (const row of LIMIT_TABLE) {
    if (prevClose < row.below) return row.width;
  }
  return 30000;
}

export function limitUpPrice(prevClose: number): number {
  return prevClose + priceLimitWidth(prevClose);
}

export function limitDownPrice(prevClose: number): number {
  return Math.max(1, prevClose - priceLimitWidth(prevClose));
}

/**
 * ストップ高張り付き: 当日の安値が制限上限に達している（= 終日上限に張り付き、買い手が約定できない）。
 * バックテストでは「この日に新規買いの指値は約定しない」と扱う。
 */
export function isLimitUpLocked(
  bar: { low: number; high: number },
  prevClose: number,
): boolean {
  const up = limitUpPrice(prevClose);
  return bar.low >= up;
}

/**
 * ストップ安張り付き: 当日の高値が制限下限以下（= 終日下限に張り付き、売り手が約定できない）。
 * 損切りはこの日に約定できず、翌日へ持ち越す。
 */
export function isLimitDownLocked(
  bar: { low: number; high: number },
  prevClose: number,
): boolean {
  const down = limitDownPrice(prevClose);
  return bar.high <= down;
}
