import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'cmargleon@gmail.com';
const PASSWORD = 'master';
const DIR = '/tmp/playwright-models';

async function shot(page: any, name: string) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const p = `${DIR}/${name}.png`;
  await page.screenshot({ path: p });
  console.log(`📸 ${p}`);
  return p;
}

test('Flujo Generar con IA — fal.ai GPT Image 2 provider', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Capturar errores de consola
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`🔴 Browser error: ${msg.text()}`);
  });

  // ── 1. Login ──────────────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 });
  await page.waitForTimeout(2000);
  console.log('✅ Login OK');

  // ── 2. Ir a /models ────────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/models`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await shot(page, '01-models-page');

  // ── 3. Seleccionar cliente ─────────────────────────────────────────────────
  await page.locator('select#client').waitFor({ timeout: 10000 });
  const opts = await page.locator('select#client option').all();
  await page.selectOption('select#client', await opts[1].getAttribute('value') ?? '');
  console.log(`✅ Cliente: ${(await opts[1].textContent())?.trim()}`);

  // ── 4. Nombre del modelo ───────────────────────────────────────────────────
  const modelName = `Modelo IA ${Date.now().toString().slice(-5)}`;
  await page.fill('input#model-name', modelName);
  console.log(`✅ Nombre: "${modelName}"`);

  // ── 5. Tab "Generar con IA" ────────────────────────────────────────────────
  await page.getByRole('button', { name: /generar con ia/i }).click();
  await page.waitForTimeout(1000);
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
  await pickRandom('Edad');
  await pickRandom('Tono de piel');
  await pickRandom('Color de pelo');
  await pickRandom('Complexión');
  await shot(page, '03-characteristics-filled');
  console.log('✅ Características completadas, usando GPT Image 2 (fal.ai)');

  // ── 8. Generar candidatos ──────────────────────────────────────────────────
  const generateBtn = page.getByRole('button', { name: /generar.*candidato/i });
  await expect(generateBtn).toBeEnabled({ timeout: 5000 });
  await generateBtn.click();
  console.log('⏳ Generando candidatos con fal.ai GPT Image 2 (1-2 min)...');
  await page.waitForTimeout(5000);
  await shot(page, '04-generating-candidates');

  // Esperar hasta que aparezca "Elegir este modelo"
  const eligeBtn = page.getByRole('button', { name: /elegir este modelo/i }).first();
  await eligeBtn.waitFor({ timeout: 300000 });
  await page.waitForTimeout(1000);
  await shot(page, '05-candidates-ready');
  console.log('✅ Candidatos generados con fal.ai GPT Image 2');

  // ── 9. Seleccionar candidato ──────────────────────────────────────────────
  await eligeBtn.click();
  await page.waitForTimeout(800);
  await shot(page, '06-candidate-selected');
  console.log('✅ Candidato seleccionado');

  // ── 10. Continuar a poses ─────────────────────────────────────────────────
  const continuarBtn = page.getByRole('button', { name: /^continuar$/i });
  await expect(continuarBtn).toBeEnabled({ timeout: 5000 });
  await continuarBtn.click();
  await page.waitForTimeout(1000);
  await shot(page, '07-poses-step');
  console.log('✅ Paso de poses abierto');

  // ── 11. Seleccionar todas las poses ──────────────────────────────────────
  const selectAll = page.getByRole('button', { name: /seleccionar todas/i }).first();
  if (await selectAll.isVisible({ timeout: 3000 }).catch(() => false)) {
    await selectAll.click();
    await page.waitForTimeout(500);
  }
  await shot(page, '08-poses-selected');
  console.log('✅ Poses seleccionadas');

  // ── 12. Generar poses ────────────────────────────────────────────────────
  const generatePosesBtn = page.getByRole('button', { name: /generar poses/i });
  await expect(generatePosesBtn).toBeEnabled({ timeout: 5000 });
  await generatePosesBtn.click();
  console.log('⏳ Generando poses con fal.ai GPT Image 2 (1-2 min)...');
  await page.waitForTimeout(5000);
  await shot(page, '09-generating-poses');

  // Esperar "Guardar modelo con estas poses"
  const saveBtn = page.getByRole('button', { name: /guardar modelo con estas poses/i });
  await saveBtn.waitFor({ timeout: 300000 });
  await page.waitForTimeout(1500);
  await shot(page, '10-poses-ready');
  console.log('✅ Poses generadas con fal.ai GPT Image 2');

  // ── 13. Aceptar todas ────────────────────────────────────────────────────
  const acceptAll = page.getByRole('button', { name: /seleccionar todas/i }).last();
  if (await acceptAll.isVisible({ timeout: 3000 }).catch(() => false)) {
    await acceptAll.click();
    await page.waitForTimeout(500);
  }
  await shot(page, '11-poses-accepted');

  // ── 14. Guardar modelo ────────────────────────────────────────────────────
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  console.log('⏳ Guardando modelo...');

  await page.locator('text=Modelo creado con éxito').waitFor({ timeout: 30000 });
  await shot(page, '12-model-saved');
  console.log('✅ ¡Modelo guardado!');

  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await shot(page, '13-library-final');

  await browser.close();
  console.log('\n🎉 ¡Flujo completo exitoso con fal.ai GPT Image 2!');
});
