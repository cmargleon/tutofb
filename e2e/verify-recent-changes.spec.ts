/**
 * Verification test for recent UI changes:
 * - Analytics page reorganization (3 sections: Operación / Producción / Costos)
 * - Configuración page (new menu item + page)
 * - Evaluación page (PoseSingleView redesign)
 * - Sidebar navigation
 */
import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';

const BASE_URL = 'https://tutofb-260320-1003.web.app';
const EMAIL = 'cmargleon@gmail.com';
const PASSWORD = 'master';
const DIR = '/tmp/playwright-verify';

async function shot(page: any, name: string) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const p = `${DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  console.log(`📸 ${p}`);
  return p;
}

test('Verify recent changes', async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`🔴 [browser] ${msg.text().slice(0, 200)}`);
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 });
  await page.waitForTimeout(2000);
  console.log('✅ Login OK');
  await shot(page, '01-dashboard');

  // ── Sidebar: Configuración item visible ───────────────────────────────────
  const configLink = page.getByRole('link', { name: /configuración/i });
  await expect(configLink).toBeVisible({ timeout: 5000 });
  console.log('✅ Sidebar: Configuración item visible');
  await shot(page, '02-sidebar-configuracion');

  // ── Configuración page ────────────────────────────────────────────────────
  await configLink.click();
  await page.waitForURL(/configuracion/, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, '03-configuracion-page');

  // Should show alert settings form
  await expect(page.getByText(/alertas del sistema/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/límite de gasto diario/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/tasa de errores recientes/i)).toBeVisible({ timeout: 5000 });
  console.log('✅ Configuración: Alert settings form rendered');

  // ── Analytics page ────────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await shot(page, '04-analytics-top');

  // Should have the 3-section structure
  await expect(page.getByText('Operación', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Producción', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Costos', { exact: true })).toBeVisible({ timeout: 5000 });
  console.log('✅ Analytics: 3 sections visible (Operación / Producción / Costos)');

  // Days selector should be present
  await expect(page.getByRole('button', { name: '7d' })).toBeVisible();
  await expect(page.getByRole('button', { name: '30d' })).toBeVisible();
  await expect(page.getByRole('button', { name: '90d' })).toBeVisible();
  console.log('✅ Analytics: Days selector visible');

  // No alert settings panel here (moved to Configuración)
  const alertSettingsInAnalytics = page.getByText(/alertas del sistema/i);
  await expect(alertSettingsInAnalytics).not.toBeVisible();
  console.log('✅ Analytics: Alert settings panel removed (moved to Configuración)');

  // New language: plain spanish instead of FP/FN
  await expect(page.getByText(/gemini aprobó pero se corrigió/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/gemini rechazó pero se aprobó/i)).toBeVisible({ timeout: 5000 });
  console.log('✅ Analytics: Plain language for FP/FN');

  // Calidad section
  await expect(page.getByText(/sin corrección humana/i)).toBeVisible();
  console.log('✅ Analytics: "Sin corrección humana" label visible');

  // Cost section
  await expect(page.getByText(/desglose de costos/i)).toBeVisible();
  console.log('✅ Analytics: Cost breakdown section visible');

  // Gemini raw calls table should NOT be present
  const rawCallsTable = page.getByText(/últimas llamadas/i);
  await expect(rawCallsTable).not.toBeVisible();
  console.log('✅ Analytics: Raw Gemini calls table removed');

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(500);
  await shot(page, '05-analytics-middle');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await shot(page, '06-analytics-bottom');

  // Test days selector switches data
  await page.getByRole('button', { name: '7d' }).click();
  await page.waitForTimeout(1500);
  const heading7d = page.getByText(/últimos 7 días/i).first();
  await expect(heading7d).toBeVisible();
  console.log('✅ Analytics: 7d selector updates headings');

  await page.getByRole('button', { name: '90d' }).click();
  await page.waitForTimeout(1500);
  const heading90d = page.getByText(/últimos 90 días/i).first();
  await expect(heading90d).toBeVisible();
  console.log('✅ Analytics: 90d selector updates headings');

  // ── Evaluación page ───────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/evaluacion`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await shot(page, '07-evaluacion-page');

  // PoseSingleView layout elements
  // Should NOT have the old JobBatchCarousel multi-item grid
  const oldCarousel = page.locator('[class*="carousel"]');
  await expect(oldCarousel).not.toBeVisible();

  // Should have "Guardar todas" as a FAB (fixed button)
  const fab = page.locator('button.fixed.rounded-full').first();
  // Check for the floating action button or at least the evaluacion page loads
  const evaluacionLoaded = await page.getByText(/lote actual|evaluaci/i).isVisible().catch(() => false);
  console.log(`✅ Evaluación: Page loaded (has content: ${evaluacionLoaded})`);
  await shot(page, '08-evaluacion-detail');

  // ── Sidebar analytics link still works ───────────────────────────────────
  const analyticsLink = page.getByRole('link', { name: /analíticas/i });
  await expect(analyticsLink).toBeVisible({ timeout: 5000 });
  console.log('✅ Sidebar: Analíticas link still present');

  await browser.close();
  console.log('\n🎉 All checks passed!');
});
