import {
  MARKET_INDEX_CODE,
  type DailyBar,
  type DisclosureData,
  type FinancialResultData,
  type MarketDataset,
  type SymbolData,
} from '../types/index.js';

/** Deterministic PRNG (mulberry32) so seed data + tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate business-day ISO dates (Mon–Fri) in [start, end]. */
export function businessDays(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

interface SymbolSpec {
  code: string;
  name: string;
  market: string;
  sector: string;
  marketCapJpy: number;
  start: number;
  /** drift per day (fraction). Can be a function of progress 0..1 */
  driftFn: (t: number) => number;
  noise: number;
  baseVolume: number;
  /** indices (0..1 progress) where an earnings gap happens */
  earningsAt: number[];
  earningsGapPct: number;
}

const SPECS: SymbolSpec[] = [
  {
    code: '7203A',
    name: 'Alpha Growth',
    market: 'TSE Prime',
    sector: 'Information & Communication',
    marketCapJpy: 80_000_000_000,
    start: 1500,
    driftFn: () => 0.0016,
    noise: 0.012,
    baseVolume: 300_000,
    earningsAt: [0.25, 0.5, 0.75],
    earningsGapPct: 0.04,
  },
  {
    code: '6501B',
    name: 'Beta Tech',
    market: 'TSE Growth',
    sector: 'Electric Appliances',
    marketCapJpy: 40_000_000_000,
    start: 1200,
    driftFn: (t) => (t < 0.3 ? 0.0002 : 0.0022),
    noise: 0.015,
    baseVolume: 250_000,
    earningsAt: [0.3, 0.55, 0.8],
    earningsGapPct: 0.09,
  },
  {
    code: '9984C',
    name: 'Gamma Health',
    market: 'TSE Prime',
    sector: 'Pharmaceutical',
    marketCapJpy: 120_000_000_000,
    start: 2200,
    driftFn: () => 0.0011,
    noise: 0.01,
    baseVolume: 200_000,
    earningsAt: [0.25, 0.5, 0.75],
    earningsGapPct: 0.03,
  },
  {
    code: '4755D',
    name: 'Delta Retail',
    market: 'TSE Standard',
    sector: 'Retail Trade',
    marketCapJpy: 25_000_000_000,
    start: 1800,
    driftFn: (t) => (t < 0.45 ? 0.0018 : -0.0026),
    noise: 0.016,
    baseVolume: 220_000,
    earningsAt: [0.2, 0.45, 0.7],
    earningsGapPct: 0.05,
  },
  {
    code: '3092E',
    name: 'Epsilon Mobility',
    market: 'TSE Growth',
    sector: 'Services',
    marketCapJpy: 30_000_000_000,
    start: 900,
    driftFn: (t) => Math.sin(t * Math.PI * 6) * 0.0009,
    noise: 0.013,
    baseVolume: 180_000,
    earningsAt: [0.3, 0.6, 0.9],
    earningsGapPct: 0.02,
  },
];

function buildBars(spec: SymbolSpec, dates: string[], rng: () => number): DailyBar[] {
  const bars: DailyBar[] = [];
  let close = spec.start;
  const earningsIdx = new Set(spec.earningsAt.map((p) => Math.floor(p * dates.length)));

  for (let i = 0; i < dates.length; i++) {
    const t = i / dates.length;
    const drift = spec.driftFn(t);
    const shock = (rng() - 0.5) * 2 * spec.noise;
    let gap = 0;
    let volMult = 1 + rng() * 0.5;
    if (earningsIdx.has(i)) {
      gap = spec.earningsGapPct;
      volMult = 2.5 + rng() * 1.5; // volume surge on earnings
    }
    const prevClose = close;
    const open = Math.round(prevClose * (1 + gap * 0.6));
    close = Math.max(50, Math.round(prevClose * (1 + drift + shock + gap * 0.4)));
    const high = Math.max(open, close, Math.round(Math.max(open, close) * (1 + Math.abs(shock) * 0.6 + 0.004)));
    const low = Math.min(open, close, Math.round(Math.min(open, close) * (1 - Math.abs(shock) * 0.6 - 0.004)));
    const volume = Math.round(spec.baseVolume * volMult);
    bars.push({
      symbolCode: spec.code,
      date: dates[i]!,
      open,
      high,
      low,
      close,
      volume,
      turnoverValue: close * volume,
    });
  }
  return bars;
}

function buildFinancials(spec: SymbolSpec, dates: string[]): FinancialResultData[] {
  const fins: FinancialResultData[] = [];
  const strong = spec.code === '6501B' || spec.code === '7203A' || spec.code === '9984C';
  spec.earningsAt.forEach((p, idx) => {
    const date = dates[Math.floor(p * dates.length)] ?? dates[dates.length - 1]!;
    const salesYoy = strong ? 14 + idx * 6 : 6 + idx * 2;
    const opYoy = strong ? 24 + idx * 10 : 5 + idx * 3;
    const marginCur = strong ? 12 + idx * 1.5 : 8 + idx * 0.4;
    fins.push({
      symbolCode: spec.code,
      announcedAt: date,
      fiscalPeriod: `FY-Q${(idx % 4) + 1}`,
      sales: 10_000_000_000 + idx * 1_000_000_000,
      operatingProfit: 1_200_000_000 + idx * 200_000_000,
      ordinaryProfit: 1_150_000_000 + idx * 190_000_000,
      netIncome: 800_000_000 + idx * 120_000_000,
      salesYoyPct: salesYoy,
      operatingProfitYoyPct: opYoy,
      operatingMarginPct: marginCur,
      operatingMarginPrevPct: marginCur - (strong ? 1.5 : 0.2),
      roePct: spec.code === '9984C' ? 15 + idx : strong ? 12 + idx : 8 + idx * 0.5,
      progressRateOpPct: strong ? 55 + idx * 5 : 40 + idx * 3,
      // strong names convert profit to cash (CF > net income); weak names lag it
      operatingCashFlowJpy: strong
        ? (800_000_000 + idx * 120_000_000) * 1.2
        : (800_000_000 + idx * 120_000_000) * 0.4,
      guidanceRevision: strong && idx >= 1 ? 'up' : 'none',
    });
  });
  return fins;
}

function buildDisclosures(spec: SymbolSpec, fins: FinancialResultData[]): DisclosureData[] {
  return fins.map((f) => ({
    symbolCode: spec.code,
    disclosedAt: f.announcedAt,
    disclosureType: f.guidanceRevision === 'up' ? 'guidance_up' : 'earnings',
    title: `${spec.name} ${f.fiscalPeriod} 決算${f.guidanceRevision === 'up' ? '・上方修正' : ''}`,
    summary: `売上YoY +${f.salesYoyPct}% / 営業利益YoY +${f.operatingProfitYoyPct}% / 営業利益率 ${f.operatingMarginPct}%`,
  }));
}

export interface SampleDatasetOptions {
  startDate?: string;
  endDate?: string;
  seed?: number;
}

/** Build the full synthetic dataset (symbols + ~2y prices + financials + disclosures). */
export function buildSampleDataset(options: SampleDatasetOptions = {}): MarketDataset {
  const startDate = options.startDate ?? '2022-01-04';
  const endDate = options.endDate ?? '2023-12-29';
  const dates = businessDays(startDate, endDate);
  const rng = mulberry32(options.seed ?? 42);

  const symbols: SymbolData[] = [];
  const prices: DailyBar[] = [];
  const financials: FinancialResultData[] = [];
  const disclosures: DisclosureData[] = [];

  // Synthetic mid/small-cap growth index (GROWTH_MOCK) with an explicit risk_off
  // drawdown (~progress 0.3–0.5) so MarketRegimeFilter is exercised by the seed.
  // Registered as an inactive symbol (for FK integrity) but never a tradeable candidate.
  symbols.push({
    code: MARKET_INDEX_CODE,
    name: 'Mid/Small Growth Index (mock)',
    market: 'INDEX',
    sector: 'Index',
    marketCapJpy: null,
    lotSize: 1,
    isActive: false,
  });
  let idx = 1000;
  for (let i = 0; i < dates.length; i++) {
    const t = i / dates.length;
    const drift = t < 0.3 ? 0.0012 : t < 0.5 ? -0.0026 : 0.0014; // up, dip, recover
    const shock = (rng() - 0.5) * 2 * 0.008;
    const prev = idx;
    idx = Math.max(100, Math.round(prev * (1 + drift + shock)));
    const high = Math.max(prev, idx) + 3;
    const low = Math.min(prev, idx) - 3;
    prices.push({
      symbolCode: MARKET_INDEX_CODE,
      date: dates[i]!,
      open: prev,
      high,
      low,
      close: idx,
      volume: 0,
      turnoverValue: 0,
    });
  }

  for (const spec of SPECS) {
    symbols.push({
      code: spec.code,
      name: spec.name,
      market: spec.market,
      sector: spec.sector,
      marketCapJpy: spec.marketCapJpy,
      lotSize: 100,
      isActive: true,
    });
    prices.push(...buildBars(spec, dates, rng));
    const fins = buildFinancials(spec, dates);
    financials.push(...fins);
    disclosures.push(...buildDisclosures(spec, fins));
  }

  return { symbols, prices, financials, disclosures };
}
