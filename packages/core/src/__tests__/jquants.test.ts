import { describe, it, expect } from 'vitest';
import { JQuantsProvider, createJQuantsProvider } from '../market/JQuantsProvider.js';

describe('JQuantsProvider', () => {
  it('sets tokenExpiresAt ~23h ahead when idToken is provided', () => {
    const before = Date.now();
    const p = new JQuantsProvider({
      baseUrl: 'https://api.jquants.com/v1',
      idToken: 'test-token',
      plan: 'free',
      enableAddons: false,
    });
    const after = Date.now();
    // Access private field via any cast — we verify the expiry is set correctly
    const expiresAt = (p as unknown as { tokenExpiresAt: number }).tokenExpiresAt;
    const expectedMin = before + 22 * 60 * 60 * 1000;
    const expectedMax = after + 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it('throws on API call when no credentials provided', async () => {
    const p = new JQuantsProvider({
      baseUrl: 'https://api.jquants.com/v1',
      plan: 'free',
      enableAddons: false,
    });
    await expect(p.fetchListedIssueMaster(new Date())).rejects.toThrow();
  });

  it('createJQuantsProvider returns null when no credentials in env', () => {
    const result = createJQuantsProvider({});
    expect(result).toBeNull();
  });

  it('createJQuantsProvider returns provider when idToken is in env', () => {
    const result = createJQuantsProvider({
      JQUANTS_ID_TOKEN: 'some-token',
      JQUANTS_BASE_URL: 'https://api.jquants.com/v1',
      JQUANTS_PLAN: 'free',
    });
    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(JQuantsProvider);
  });
});
