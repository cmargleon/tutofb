import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';

const DIR = '/tmp/playwright-models';

test('debug generate model pose call', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  // Intercept Firebase function calls
  page.on('request', req => {
    if (req.url().includes('cloudfunctions') || req.url().includes('us-central1')) {
      console.log(`📤 ${req.method()} ${req.url().split('?')[0].split('/').slice(-2).join('/')}`);
    }
  });
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('cloudfunctions') || url.includes('us-central1') || url.includes('generatemodelpose')) {
      const status = resp.status();
      console.log(`📥 ${status} ${url.split('?')[0].split('/').slice(-2).join('/')}`);
      if (status !== 200) {
        try { console.log(`   Body: ${(await resp.text()).slice(0, 300)}`); } catch (_) {}
      }
    }
  });
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[browser error] ${msg.text()}`);
  });

  // Login
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', 'cmargleon@gmail.com');
  await page.fill('input[type="password"]', 'master');
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 });
  await page.waitForTimeout(2000);

  await page.goto('http://localhost:3000/models', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const opts = await page.locator('select#client option').all();
  await page.selectOption('select#client', await opts[1].getAttribute('value') ?? '');
  await page.fill('input#model-name', 'Test Debug');

  await page.getByRole('button', { name: /generar con ia/i }).click();
  await page.waitForTimeout(1000);

  // Select OpenAI provider
  const providerSel = page.locator('label:has-text("Proveedor IA")').locator('..').locator('select');
  const provOpts = await providerSel.locator('option').all();
  for (const opt of provOpts) {
    const val = await opt.getAttribute('value');
    if (val?.includes('openai')) { await providerSel.selectOption(val); console.log(`✅ Provider: ${val}`); break; }
  }

  await page.screenshot({ path: `${DIR}/d1-ready.png` });

  const genBtn = page.getByRole('button', { name: /generar.*candidato/i });
  await expect(genBtn).toBeEnabled({ timeout: 5000 });
  await genBtn.click();
  console.log('Clicked generate — watching network...');

  // Poll every 20s for status
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(20000);
    const hasCandidates = await page.getByRole('button', { name: /elegir este modelo/i }).isVisible().catch(() => false);
    const isGenerating = await page.getByRole('button', { name: /generando/i }).isVisible().catch(() => false);
    const alertText = await page.locator('[role="alert"], [class*="red-"]').textContent().catch(() => '');
    console.log(`t=${(i+1)*20}s — generating:${isGenerating} candidates:${hasCandidates} alert:"${alertText?.trim().slice(0, 100)}"`);
    await page.screenshot({ path: `${DIR}/d${i+2}-t${(i+1)*20}s.png` });
    if (hasCandidates) { console.log('✅ Candidates appeared!'); break; }
    if (!isGenerating && !hasCandidates) { console.log('⚠️ Generation stopped (error or reset)'); break; }
  }

  await browser.close();
});
