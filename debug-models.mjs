import { chromium } from 'playwright';
import fs from 'fs';

const DIR = '/tmp/playwright-models';
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

// Network interception
page.on('request', req => {
  if (req.url().includes('us-central1') || req.url().includes('generatemodelpose')) {
    console.log(`📤 ${req.method()} .../${req.url().split('/').slice(-3).join('/')}`);
  }
});
page.on('response', async resp => {
  const url = resp.url();
  if (url.includes('us-central1') || url.includes('generatemodelpose')) {
    const status = resp.status();
    const shortUrl = url.split('/').slice(-3).join('/');
    console.log(`📥 ${status} .../${shortUrl}`);
    if (status !== 200) {
      try { console.log(`   Body: ${(await resp.text()).slice(0, 400)}`); } catch (_) {}
    }
  }
});
page.on('console', msg => {
  if (msg.type() === 'error') console.log(`[browser error] ${msg.text()}`);
});

// Login
console.log('Logging in...');
await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.fill('input[type="email"]', 'cmargleon@gmail.com');
await page.fill('input[type="password"]', 'master');
await page.click('button[type="submit"]');
await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 });
await page.waitForTimeout(2000);
console.log('✅ Logged in');

// Models page
await page.goto('http://localhost:3000/models', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const opts = await page.locator('select#client option').all();
await page.selectOption('select#client', await opts[1].getAttribute('value') ?? '');
const clientName = (await opts[1].textContent())?.trim();
console.log(`✅ Client: ${clientName}`);

await page.fill('input#model-name', 'Test Debug AI');

// Click AI tab
await page.getByRole('button', { name: /generar con ia/i }).click();
await page.waitForTimeout(1000);

// Select OpenAI
const providerSel = page.locator('label:has-text("Proveedor IA")').locator('..').locator('select');
const provOpts = await providerSel.locator('option').all();
for (const opt of provOpts) {
  const val = await opt.getAttribute('value');
  if (val?.includes('openai')) {
    await providerSel.selectOption(val);
    console.log(`✅ Provider: ${val}`);
    break;
  }
}

await page.screenshot({ path: `${DIR}/d0-before-generate.png` });

// Click generate
const genBtn = page.getByRole('button', { name: /generar.*candidato/i });
await genBtn.waitFor({ timeout: 5000 });
await genBtn.click();
console.log('⏳ Clicked generate — monitoring...');
const startTime = Date.now();

// Poll every 15s
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(15000);
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const hasCandidates = await page.getByRole('button', { name: /elegir este modelo/i }).isVisible().catch(() => false);
  const isGenerating = await page.getByRole('button', { name: /generando/i }).isVisible().catch(() => false);
  const bodyText = await page.textContent('body').catch(() => '');
  const hasError = bodyText?.toLowerCase().includes('error al generar') || bodyText?.toLowerCase().includes('error:');

  // Grab any toast/alert text
  const toastText = await page.locator('[data-sonner-toast], [role="alert"], [class*="toast"]').textContent().catch(() => '');

  console.log(`t=${elapsed}s — generating:${isGenerating} candidates:${hasCandidates} error:${hasError} toast:"${toastText?.trim().slice(0, 150)}"`);
  await page.screenshot({ path: `${DIR}/d${i+1}-t${elapsed}s.png` });

  if (hasCandidates) { console.log('✅ Candidates appeared!'); break; }
  if (!isGenerating && !hasCandidates) {
    console.log('⚠️ Generation stopped without candidates');
    // Print visible page text for diagnosis
    console.log('Page text snippet:', bodyText?.slice(0, 1000));
    break;
  }
}

await browser.close();
console.log('Done');
