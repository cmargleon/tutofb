import { test, chromium } from '@playwright/test';

test('catalog barbie job status check', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', 'cmargleon@gmail.com');
  await page.fill('input[type="password"]', 'master');
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 });
  await page.waitForTimeout(2000);

  await page.goto('http://localhost:3000/catalogo', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Find and select Barbie
  const clientSelect = page.locator('select').first();
  const options = await clientSelect.locator('option').allInnerTexts();
  console.log('Client options:', options);
  const barbieOption = options.find(o => o.toLowerCase().includes('barbie'));
  if (barbieOption) {
    await clientSelect.selectOption({ label: barbieOption });
  }
  await page.waitForTimeout(5000);

  const spinners = await page.locator('.animate-spin').count();
  console.log(`Spinners visible: ${spinners}`);

  const thumbnails = page.locator('button[title]');
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

  await page.screenshot({ path: '/tmp/catalog-barbie.png' });
  console.log('Screenshot: /tmp/catalog-barbie.png');
  await browser.close();
});
