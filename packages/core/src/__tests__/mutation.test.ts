import { describe, it, expect } from 'vitest';
import { DEFAULT_STRATEGY_CONFIG } from '../config/defaults.js';
import {
  MUTABLE_GENES,
  mutateConfig,
  generateDiverseChallengers,
  countGeneDiffs,
  geneValue,
} from '../evolution/mutation.js';

/** Deterministic RNG (mulberry32) so tests are reproducible. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const parent = DEFAULT_STRATEGY_CONFIG;

describe('mutateConfig', () => {
  it('keeps every mutable gene within its declared bounds', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 50; i++) {
      const child = mutateConfig(parent, rng);
      for (const g of MUTABLE_GENES) {
        const v = geneValue(child, g.path);
        expect(v).toBeGreaterThanOrEqual(g.min);
        expect(v).toBeLessThanOrEqual(g.max);
        if (g.integer) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('differs from the parent by at least 2 genes (real mutation)', () => {
    const rng = seededRng(2);
    for (let i = 0; i < 30; i++) {
      const child = mutateConfig(parent, rng);
      expect(countGeneDiffs(parent, child)).toBeGreaterThanOrEqual(2);
    }
  });

  it('leaves non-gene structure (scheduler times) untouched', () => {
    const child = mutateConfig(parent, seededRng(3));
    expect(child.scheduler).toEqual(parent.scheduler);
    expect(child.universe).toEqual(parent.universe);
  });
});

describe('generateDiverseChallengers', () => {
  it('produces N challengers, each distinct from parent and from each other', () => {
    const n = 5;
    const challengers = generateDiverseChallengers(parent, n, [], seededRng(42));
    expect(challengers).toHaveLength(n);
    for (const c of challengers) {
      expect(countGeneDiffs(parent, c)).toBeGreaterThanOrEqual(2);
    }
    for (let i = 0; i < challengers.length; i++) {
      for (let j = i + 1; j < challengers.length; j++) {
        expect(countGeneDiffs(challengers[i]!, challengers[j]!)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('also stays distinct from pre-existing siblings', () => {
    const existing = generateDiverseChallengers(parent, 3, [], seededRng(7));
    const more = generateDiverseChallengers(parent, 2, existing, seededRng(8));
    for (const m of more) {
      for (const e of existing) {
        expect(countGeneDiffs(m, e)).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
