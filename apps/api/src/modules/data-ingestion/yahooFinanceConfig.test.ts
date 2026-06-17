import { describe, expect, it } from 'vitest';
import { parseYahooFinanceMaxSymbols } from './yahooFinanceConfig.js';

describe('parseYahooFinanceMaxSymbols', () => {
  it('treats empty, missing, and zero values as no symbol limit', () => {
    expect(parseYahooFinanceMaxSymbols(undefined)).toBeUndefined();
    expect(parseYahooFinanceMaxSymbols('')).toBeUndefined();
    expect(parseYahooFinanceMaxSymbols('0')).toBeUndefined();
  });

  it('uses a positive integer as the symbol limit', () => {
    expect(parseYahooFinanceMaxSymbols('4455')).toBe(4455);
  });
});
