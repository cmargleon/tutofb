import { test, expect, chromium } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

test('analytics renders Recharts without hook errors across period changes and reloads', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  const { page } = isolated;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('[vite] failed to connect to websocket.')) {
      errors.push(message.text());
    }
  });

  try {
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Analíticas', exact: true })).toBeVisible();
    // The completed-job fixture exercises ResponsiveContainer and its React context.
    await expect(page.getByRole('application')).toBeVisible();
    await page.getByRole('button', { name: '7d', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Volumen diario (últimos 7 días)' })).toBeVisible();
    await page.getByRole('button', { name: '90d', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Volumen diario (últimos 90 días)' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('application')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await isolated.close();
  }
});
