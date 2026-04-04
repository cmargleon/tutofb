import { test, chromium } from '@playwright/test';
import fs from 'fs';

test('catalog draft panel detail images', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', msg => { if (msg.type() === 'error') console.log(`[ERR] ${msg.text().slice(0, 200)}`); });

  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', 'cmargleon@gmail.com');
  await page.fill('input[type="password"]', 'master');
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 });
  await page.waitForTimeout(2000);

  await page.goto('http://localhost:3000/catalogo', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Select Barbie
  const clientSelect = page.locator('select').first();
  const options = await clientSelect.locator('option').allInnerTexts();
  const barbieOption = options.find(o => o.toLowerCase().includes('barbie'));
  if (barbieOption) await clientSelect.selectOption({ label: barbieOption });
  await page.waitForTimeout(4000);

  // Get all photo thumbnails with images (completed jobs)
  const thumbnails = page.locator('button[title] img');
  const count = await thumbnails.count();
  console.log(`Found ${count} thumbnails with images`);

  if (count === 0) { console.log('No thumbnails found'); await browser.close(); return; }

  // Click the last photo thumbnail
  await thumbnails.last().click();
  await page.waitForTimeout(3000);

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
  await browser.close();
});
