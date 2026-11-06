import { openIsolatedBrowser } from './support/isolated-browser.mjs';
import { test, expect, chromium } from '@playwright/test';

test('catalog draft panel detail images', async () => {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 1440, height: 900 } });
  const { page, baseURL: BASE_URL } = isolated;
  try {

  page.on('console', msg => { if (msg.type() === 'error') console.log(`[ERR] ${msg.text().slice(0, 200)}`); });

  // Auth is a disposable local double; this journey does not test login.

  await page.goto(`${BASE_URL}/catalogo`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(100);

  // Select the disposable client fixture
  const clientSelect = page.locator('select').first();
  await expect(clientSelect.locator('option[value="local-client"]')).toHaveCount(1);
  const options = await clientSelect.locator('option').allInnerTexts();
  const localOption = options.find(o => o === 'Cliente local');
  if (localOption) await clientSelect.selectOption({ label: localOption });
  await page.waitForTimeout(100);

  // Get all photo thumbnails with images (completed jobs)
  const thumbnails = page.locator('[role="button"][title="Artículo local"] img');
  await expect(thumbnails).toHaveCount(2);
  const count = await thumbnails.count();
  console.log(`Found ${count} thumbnails with images`);


  // Click the last photo thumbnail
  await thumbnails.last().click();
  await page.waitForTimeout(100);

  await expect(page.getByText('Imagen principal', { exact: true })).toBeVisible();
  await expect(page.getByText('Imagen detalle 1', { exact: true })).toBeVisible();

  // Screenshot of the lightbox
  await page.screenshot({ path: '/tmp/lightbox-open.png', fullPage: false });

  // Look for the Excel panel and detail image fields
  const panelText = await page.locator('aside').allInnerTexts();
  console.log('Panel text:', panelText.join('\n').slice(0, 2000));

  // Look for input fields with "detalle" or "detail" in their labels
  const allLabels = await page.locator('label').allInnerTexts();
  const detailLabels = allLabels.filter(l => l.toLowerCase().includes('detalle') || l.toLowerCase().includes('detail') || l.toLowerCase().includes('imagen'));
  console.log('Detail-related labels:', detailLabels);

  // Look for any input/textarea values containing storage URLs
  const inputs = page.locator('input[type="text"], textarea');
  const inputCount = await inputs.count();
  console.log(`Total inputs: ${inputCount}`);
  for (let i = 0; i < Math.min(inputCount, 30); i++) {
    const val = await inputs.nth(i).inputValue();
    const placeholder = await inputs.nth(i).getAttribute('placeholder') || '';
    if (val || placeholder) {
      console.log(`input[${i}] placeholder="${placeholder}" value="${val.slice(0, 100)}"`);
    }
  }

  await page.screenshot({ path: '/tmp/lightbox-panel.png', fullPage: false });
  console.log('Screenshots saved');
  } finally { await isolated.close(); }
});
