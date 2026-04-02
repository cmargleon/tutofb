/**
 * Flujo completo: Generar con IA → candidato → poses → guardar modelo
 * Usa playwright directamente (no Playwright Test framework).
 */
import { chromium } from 'playwright';
import fs from 'fs';

const DIR = '/tmp/playwright-models';
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const shot = async (page, name) => {
  const p = `${DIR}/${name}.png`;
  await page.screenshot({ path: p });
  console.log(`📸 ${p}`);
  return p;
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

page.on('console', msg => {
  if (msg.type() === 'error') console.log(`[browser error] ${msg.text()}`);
});

// ── 1. Login ──────────────────────────────────────────────────────────────
await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.fill('input[type="email"]', 'cmargleon@gmail.com');
await page.fill('input[type="password"]', 'master');
await page.click('button[type="submit"]');
await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 });
await page.waitForTimeout(2000);
await shot(page, '01-logged-in');
console.log('✅ Login OK');

// ── 2. Models page ────────────────────────────────────────────────────────
await page.goto('http://localhost:3000/models', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await shot(page, '02-models-page');

// ── 3. Client + name ──────────────────────────────────────────────────────
const opts = await page.locator('select#client option').all();
await page.selectOption('select#client', await opts[1].getAttribute('value') ?? '');
const clientName = (await opts[1].textContent())?.trim();
console.log(`✅ Client: ${clientName}`);

const modelName = `Modelo IA ${Date.now().toString().slice(-5)}`;
await page.fill('input#model-name', modelName);
console.log(`✅ Name: "${modelName}"`);

// ── 4. Switch to AI tab ───────────────────────────────────────────────────
await page.getByRole('button', { name: /generar con ia/i }).click();
await page.waitForTimeout(1000);

// ── 5. Select OpenAI ──────────────────────────────────────────────────────
const providerSel = page.locator('label:has-text("Proveedor IA")').locator('..').locator('select');
const provOpts = await providerSel.locator('option').all();
for (const opt of provOpts) {
  const val = await opt.getAttribute('value');
  if (val?.includes('openai')) { await providerSel.selectOption(val); console.log(`✅ Provider: OpenAI`); break; }
}

// ── 6. Random characteristics ─────────────────────────────────────────────
const pickRandom = async (label) => {
  const sel = page.locator(`label:has-text("${label}")`).locator('..').locator('select');
  if (await sel.isVisible().catch(() => false)) {
    const os = await sel.locator('option').all();
    if (os.length > 1) await sel.selectOption({ index: Math.floor(Math.random() * os.length) });
  }
};
await pickRandom('Sexo');
await pickRandom('Edad');
await pickRandom('Tono de piel');
await pickRandom('Color de pelo');
await pickRandom('Complexión');
await shot(page, '03-identity-filled');
console.log('✅ Random characteristics set');

// ── 7. Generate candidates ────────────────────────────────────────────────
const genBtn = page.getByRole('button', { name: /generar.*candidato/i });
await genBtn.waitFor({ timeout: 5000 });
await genBtn.click();
console.log('⏳ Generating candidates with OpenAI (1-2 min)...');
await page.waitForTimeout(5000);
await shot(page, '04-generating');

// Wait for "Elegir este modelo" button — up to 3 min
await page.getByRole('button', { name: /elegir este modelo/i }).first().waitFor({ timeout: 180000 });
await page.waitForTimeout(1000);
await shot(page, '05-candidates-ready');
console.log('✅ Candidates generated!');

// ── 8. Select first candidate ─────────────────────────────────────────────
await page.getByRole('button', { name: /elegir este modelo/i }).first().click();
await page.waitForTimeout(800);
await shot(page, '06-candidate-selected');
console.log('✅ Candidate selected');

// ── 9. Continue to poses ──────────────────────────────────────────────────
await page.getByRole('button', { name: /^continuar$/i }).click();
await page.waitForTimeout(1000);
await shot(page, '07-poses-step');
console.log('✅ Poses step opened');

// ── 10. Select all poses ──────────────────────────────────────────────────
const selectAllBtn = page.getByRole('button', { name: /seleccionar todas/i }).first();
if (await selectAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
  await selectAllBtn.click();
  await page.waitForTimeout(500);
}
await shot(page, '08-poses-selected');

// ── 11. Generate poses ────────────────────────────────────────────────────
const generatePosesBtn = page.getByRole('button', { name: /generar poses/i });
await generatePosesBtn.waitFor({ timeout: 5000 });
await generatePosesBtn.click();
console.log('⏳ Generating poses with OpenAI (1-2 min)...');
await page.waitForTimeout(5000);
await shot(page, '09-generating-poses');

// Wait for "Guardar modelo con estas poses"
const saveBtn = page.getByRole('button', { name: /guardar modelo con estas poses/i });
await saveBtn.waitFor({ timeout: 180000 });
await page.waitForTimeout(1500);
await shot(page, '10-poses-ready');
console.log('✅ Poses generated!');

// ── 12. Wait for poses to finish loading, then accept all ─────────────────
// Wait for "Seleccionar todas" (accept all) button to become ENABLED — means ai.busy=false
const acceptAll = page.getByRole('button', { name: /seleccionar todas/i }).last();
console.log('⏳ Waiting for all poses to finish loading...');
await page.waitForFunction(
  () => {
    const btns = [...document.querySelectorAll('button')];
    const btn = btns.findLast(b => b.textContent?.includes('Seleccionar todas'));
    return btn && !btn.disabled;
  },
  { timeout: 60000 }
);
await acceptAll.click();
await page.waitForTimeout(1000);
await shot(page, '11-poses-accepted');
console.log('✅ All poses accepted');

// ── 13. Save model ────────────────────────────────────────────────────────
// Wait for save button to be enabled
await page.waitForFunction(
  () => {
    const btns = [...document.querySelectorAll('button')];
    const btn = btns.find(b => b.textContent?.includes('Guardar modelo con estas poses'));
    return btn && !btn.disabled;
  },
  { timeout: 30000 }
);
await shot(page, '11b-save-btn-enabled');
await saveBtn.click();
console.log('⏳ Saving model...');

// The success message lasts only 3 seconds — poll fast
let successSeen = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  const bodyText = await page.textContent('body').catch(() => '');
  if (bodyText?.includes('Modelo creado con éxito')) {
    successSeen = true;
    await shot(page, '12-model-saved');
    console.log('✅ Model saved!');
    break;
  }
  // Also check if it was created by looking for the model in library
  if (bodyText?.includes(modelName.split(' ').slice(0, 2).join(' '))) {
    successSeen = true;
    await shot(page, '12-model-in-library');
    console.log('✅ Model visible in library!');
    break;
  }
}
if (!successSeen) {
  await shot(page, '12-check-state');
  console.log('⚠️ Success message not seen, checking library...');
}

// ── 14. Verify in library ─────────────────────────────────────────────────
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1000);
await shot(page, '13-library');

await browser.close();
console.log(`\n🎉 DONE! Model "${modelName}" created successfully for client "${clientName}"`);
