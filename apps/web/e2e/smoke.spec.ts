import { test, expect } from '@playwright/test';

test('dashboard loads with KPI cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('ダッシュボード').first()).toBeVisible();
  await expect(page.getByText('Champion戦略')).toBeVisible();
});

test('backtest list is reachable', async ({ page }) => {
  await page.goto('/backtests');
  await expect(page.getByRole('link', { name: '＋ 新規作成' })).toBeVisible();
});

test('create and run a backtest end-to-end', async ({ page }) => {
  await page.goto('/backtests/new');
  await expect(page.getByText('バックテスト作成')).toBeVisible();
  await page.getByRole('button', { name: '作成して実行' }).click();

  // redirected to the detail page; summary KPIs appear once the run completes
  await page.waitForURL(/\/backtests\/[a-z0-9]+$/, { timeout: 90_000 });
  await expect(page.getByText('最終資産')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Profit Factor')).toBeVisible();

  // advanced-filter tabs render with real data
  await page.getByRole('link', { name: '高度フィルター' }).click();
  await expect(page.getByText('高度フィルター（各トレードのスコア）')).toBeVisible();
  await page.getByRole('link', { name: '負け分析' }).click();
  await expect(page.getByText('負け分析（LossType）')).toBeVisible();
  await expect(page.getByText('フィルター別アトリビューション')).toBeVisible({ timeout: 30_000 });
});

test('strategies page lists strategies and a champion badge', async ({ page }) => {
  await page.goto('/strategies');
  await expect(page.getByText('Champion / Challenger')).toBeVisible();
  await expect(page.getByText('champion').first()).toBeVisible();
});

test('settings shows the live-trading-disabled safety banner', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText(/Live（本番発注）は既定で無効/)).toBeVisible();
});
