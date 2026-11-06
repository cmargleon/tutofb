import { openIsolatedBrowser } from './support/isolated-browser.mjs';
import { test, expect, chromium } from '@playwright/test';

test('catalog local job status check', async () => {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 1440, height: 900 } });
  const { page, baseURL: BASE_URL } = isolated;
  try {

  // Auth is a disposable local double; this journey does not test login.

  await page.goto(`${BASE_URL}/catalogo`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(100);

  // Select the disposable client fixture
  const clientSelect = page.locator('select').first();
  await expect(clientSelect.locator('option[value="local-client"]')).toHaveCount(1);
  const options = await clientSelect.locator('option').allInnerTexts();
  console.log('Client options:', options);
  const localOption = options.find(o => o === 'Cliente local');
  if (localOption) {
    await clientSelect.selectOption({ label: localOption });
  }
  await page.waitForTimeout(100);

  await expect(page.locator('[role="button"][title="Artículo local"] img')).toHaveCount(2);
  await expect(page.locator('.animate-spin')).toHaveCount(0);
  const spinners = await page.locator('.animate-spin').count();
  console.log(`Spinners visible: ${spinners}`);

  const thumbnails = page.locator('[role="button"][title="Artículo local"]');
  await expect(thumbnails).toHaveCount(2);
  const count = await thumbnails.count();
  console.log(`Total thumbnails: ${count}`);

  for (let i = 0; i < Math.min(count, 12); i++) {
    const btn = thumbnails.nth(i);
    const title = await btn.getAttribute('title');
    const hasSpinner = await btn.locator('.animate-spin').count() > 0;
    const hasImg = await btn.locator('img').count() > 0;
    const text = (await btn.innerText()).replace(/\n/g,' ').slice(0, 100);
    console.log(`[${i}] "${title}" spinner=${hasSpinner} img=${hasImg} text="${text}"`);
  }

  await page.screenshot({ path: '/tmp/catalog-local.png' });
  console.log('Screenshot: /tmp/catalog-local.png');
  } finally { await isolated.close(); }
});
