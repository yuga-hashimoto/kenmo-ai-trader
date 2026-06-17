import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Assumes the API is running on :4000 (with a seeded DB) and starts
 * the Next dev server itself. Run: `pnpm --filter @kenmo/web e2e`
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'next dev -p 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? 'http://localhost:4000' },
  },
});
