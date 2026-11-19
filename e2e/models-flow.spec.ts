import { openIsolatedBrowser } from './support/isolated-browser.mjs';
import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';

const DIR = '/tmp/playwright-models';

async function shot(page: any, name: string) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const p = `${DIR}/${name}.png`;
  await page.screenshot({ path: p });
  console.log(`📸 ${p}`);
  return p;
}

test('Flujo Generar con IA — fal.ai GPT Image 2 provider', async () => {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 1440, height: 900 } });
  const { page, baseURL: BASE_URL } = isolated;
  await page.addInitScript(() => { (window as any).__modelSetsFixture = true; (window as any).__modelSetFailOnce = true; });
  await page.route('**/src/features/models/marketplaceRules/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import { defaultModelMarketplaceRule } from '/shared/src/modelMarketplaceRules.ts';
    const rules = {
      amazon: { ...defaultModelMarketplaceRule('amazon'), revision: 1, allowedPoseRecipeIds: ['full-front', 'full-front-diagonal'] },
      'tiktok-shop': { ...defaultModelMarketplaceRule('tiktok-shop'), revision: 1, allowedPoseRecipeIds: ['full-front-diagonal', 'full-three-quarter'] }
    };
    export const subscribeModelMarketplaceRules = next => { const timer = setTimeout(() => next(rules), 100); return () => clearTimeout(timer); };
    export const saveModelMarketplaceRule = async () => { throw new Error('Unexpected write'); };
  ` }));

  try {

  // Capturar errores de consola
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`🔴 Browser error: ${msg.text()}`);
  });

  // ── 1. Login ──────────────────────────────────────────────────────────────
  // Auth is a disposable local double; this journey does not test login.
  console.log('✅ Identidad local aislada');

  // ── 2. Ir a /models ────────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/models/generar`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(100);
  await shot(page, '01-models-page');

  // ── 3. Seleccionar cliente ─────────────────────────────────────────────────
  await page.locator('select#client').waitFor({ timeout: 10000 });
  await page.locator('select#client option[value="local-client"]').waitFor({ state: 'attached' });
  const opts = await page.locator('select#client option').all();
  await page.selectOption('select#client', await opts[1].getAttribute('value') ?? '');
  console.log(`✅ Cliente: ${(await opts[1].textContent())?.trim()}`);

  // ── 4. Nombre del modelo ───────────────────────────────────────────────────
  const modelName = `Modelo IA ${Date.now().toString().slice(-5)}`;
  await page.fill('input#model-name', modelName);
  console.log(`✅ Nombre: "${modelName}"`);

  // ── 5. Tab "Generar con IA" ────────────────────────────────────────────────
  await page.getByRole('button', { name: /generar con ia/i }).click();
  await page.waitForTimeout(100);
  await shot(page, '02-ai-identity-step');

  // ── 6. Seleccionar proveedor fal.ai GPT Image 2 ───────────────────────────────────────
  const providerLabel = page.locator('label:has-text("Proveedor IA")').locator('..').locator('select');
  if (await providerLabel.isVisible().catch(() => false)) {
    // Select fal.ai GPT Image 2 option
    const provOpts = await providerLabel.locator('option').all();
    for (const opt of provOpts) {
      const val = await opt.getAttribute('value');
      if (val === 'fal-gpt-image-2') {
        await providerLabel.selectOption(val);
        console.log(`✅ Proveedor: ${val}`);
        break;
      }
    }
  }

  // ── 7. Características al azar ────────────────────────────────────────────
  const pickRandom = async (label: string) => {
    const sel = page.locator(`label:has-text("${label}")`).locator('..').locator('select');
    if (await sel.isVisible().catch(() => false)) {
      const options = await sel.locator('option').all();
      if (options.length > 1) await sel.selectOption({ index: Math.floor(Math.random() * options.length) });
    }
  };
  await pickRandom('Sexo');
  await page.locator('label:has-text("Edad")').locator('..').locator('select').selectOption('25-35');
  await pickRandom('Tono de piel');
  await pickRandom('Color de pelo');
  await pickRandom('Complexión');
  await shot(page, '03-characteristics-filled');
  console.log('✅ Características completadas, usando GPT Image 2 (fal.ai)');

  // ── 8. Generar candidatos ──────────────────────────────────────────────────
  const generateBtn = page.getByRole('button', { name: /generar.*candidato/i });
  await expect(generateBtn).toBeEnabled({ timeout: 5000 });
  await generateBtn.click();
  console.log('⏳ Generando candidatos con fal.ai GPT Image 2 (fixture local)...');
  await page.waitForTimeout(100);
  await shot(page, '04-generating-candidates');

  // Esperar hasta que aparezca "Elegir este modelo"
  const eligeBtn = page.getByRole('button', { name: /elegir este modelo/i }).first();
  await eligeBtn.waitFor({ timeout: 300000 });
  await page.waitForTimeout(100);
  await shot(page, '05-candidates-ready');
  console.log('✅ Candidatos generados con fal.ai GPT Image 2');

  // ── 9. Seleccionar candidato ──────────────────────────────────────────────
  await eligeBtn.click();
  await page.waitForTimeout(100);
  await shot(page, '06-candidate-selected');
  console.log('✅ Candidato seleccionado');

  await expect(page.getByRole('button', { name: 'Aprobar identidad y preparar sets', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar a Poses', exact: true }).click();
  await expect(page).toHaveURL(/\/models\/generar$/);
  await expect(page.getByText('Identidad elegida · ' + modelName)).toBeVisible();
  for (const pose of ['Frente completa', 'Diagonal de frente', '3/4 frente']) await expect(page.getByRole('button', { name: pose, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('TikTok Shop', { exact: true }).uncheck();
  await expect(page.getByRole('button', { name: '3/4 frente', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('TikTok Shop', { exact: true }).check();
  await expect(page.getByRole('button', { name: '3/4 frente', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Frente completa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Frente completa', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Frente completa', exact: true }).click();
  await expect(page.getByText(/3 poses × 2 destinos · 6 fotografías compatibles/)).toBeVisible();
  await page.getByRole('button', { name: 'Retrato perfil izquierdo', exact: true }).click();
  await expect(page.getByText('Combinaciones incompatibles · no se cobrarán')).toBeVisible();
  await expect(page.getByText(/6 fotografías compatibles/)).toBeVisible();
  await page.getByRole('button', { name: 'Retrato perfil izquierdo', exact: true }).click();
  await page.getByRole('button', { name: 'Completar seleccionados', exact: true }).click();
  await expect(page.getByText(/Estimación USD 0.480/)).toBeVisible();
  let calls = await page.evaluate(() => (window as any).__localCalls || []);
  expect(calls.some((call: any) => call.name === 'generateModelMarketplaceBase')).toBe(false);
  await page.getByRole('button', { name: 'Generar estas bases', exact: true }).click();
  await expect(page.getByText(/5 \/ 6 tomas aprobadas/)).toBeVisible();
  await expect(page.getByText(/La pose concreta no coincide/)).toBeVisible();
  await expect(page).toHaveURL(/\/models\/generar$/);
  await page.getByRole('button', { name: 'Completar seleccionados', exact: true }).click();
  await expect(page.getByText(/Estimación USD 0.080/)).toBeVisible();
  await page.getByRole('button', { name: 'Generar estas bases', exact: true }).click();
  await expect(page.getByText(/6 \/ 6 tomas aprobadas/)).toBeVisible();
  calls = await page.evaluate(() => (window as any).__localCalls || []);
  expect(calls.filter((call: any) => call.name === 'approveModelIdentity')).toHaveLength(1);
  expect(calls.filter((call: any) => call.name === 'generateModelPose').every((call: any) => call.input.provider === 'fal-gpt-image-2')).toBe(true);
  const generated = calls.filter((call: any) => call.name === 'generateModelMarketplaceBase');
  expect(generated).toHaveLength(7);
  expect(generated[6].input.poseRecipeId).toBe('full-front-diagonal');
  expect(generated[6].input.channel).toBe('tiktok-shop');
  await shot(page, '07-poses-and-marketplaces-results');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, '08-poses-mobile');
  await page.getByRole('button', { name: 'Crear otro modelo', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Crear otro modelo', exact: true }).click();
  await expect(page.locator('input#model-name')).toHaveValue('');
  const persisted = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tuto-local-models') || '[]'));
  expect(persisted).toHaveLength(1); expect(persisted[0].poses).toHaveLength(8);
  } finally { await isolated.close(); }
});
