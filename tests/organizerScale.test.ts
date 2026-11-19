import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Unit coverage for processing a whole Drive update (≈1000 photos) without stopping half-way.
const require = createRequire(import.meta.url);
const lib = '../functions/lib';
const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-organizer-scale-unit', storageBucket: 'demo-organizer-scale-unit.appspot.com' });
const { shouldContinueRun, MAX_CHAINED_SLICES } = require(`${lib}/functions/src/organizer/worker.js`);
const { scaledRunLimits, estimatedPhotoCostUsd, callsPerPhoto, DEFAULT_BUDGET_CAP_USD, DEFAULT_MAX_CALLS_CAP } = require(`${lib}/functions/src/organizer/limits.js`);
const { chunkArticles, ORGANIZER_ARTICLES_PER_JOB, ORGANIZER_MAX_ARTICLES, organizerAutomationBudget } = require(`${lib}/functions/src/organizer/automation.js`);
const { ORGANIZER_MAX_INPUT_IMAGES, validateAutomationInput } = require(`${lib}/functions/src/automation/domain.js`);
const { resolveAutomationPolicy, effectiveMaxBudgetUsd, validateClientMaxBudget, DEFAULT_AUTOMATION_BUDGET } = require(`${lib}/shared/src/automationPolicy.js`);
const { inParallel, EXPORT_LIMITS } = require(`${lib}/functions/src/spreadsheets/marketplaceExportService.js`);

const config = { model: 'gemini-3.1-flash-lite', escalationModel: null, budgetUsd: 2, maxCalls: 300 };

test('punto 1: las ejecuciones automáticas encadenan tramos hasta el tope de seguridad', () => {
  assert.equal(shouldContinueRun({ status: 'running' }, { status: 'queued', createdBy: 'watcher', error: null, chainedSlices: 1 }), true);
  assert.equal(shouldContinueRun({ status: 'running' }, { status: 'queued', createdBy: 'watcher', chainedSlices: MAX_CHAINED_SLICES - 1 }), true);
  assert.equal(shouldContinueRun({ status: 'running' }, { status: 'queued', createdBy: 'watcher', chainedSlices: MAX_CHAINED_SLICES }), false,
    'Más allá del tope espera al programador (12:00/18:00) sin perder avance');
  assert.equal(shouldContinueRun({ status: 'running' }, { status: 'queued', createdBy: 'uid', chainedSlices: MAX_CHAINED_SLICES }), false);
  assert.equal(shouldContinueRun({ status: 'running' }, { status: 'queued', createdBy: 'watcher', error: 'HTTP 429' }), false, 'El throttling espera al programador');
  assert.equal(shouldContinueRun({ status: 'paused' }, { status: 'queued', createdBy: 'watcher', chainedSlices: MAX_CHAINED_SLICES }), true, 'Reanudar es una acción humana');
  // 1000 fotos ≈ 2 h de visión en tramos de ~380 s ≈ 20 tramos, muy por debajo del tope.
  assert.ok(MAX_CHAINED_SLICES * 380 / 3600 > 24);
});

test('puntos 2 y 3: llamadas y presupuesto escalan con las fotos, con piso y tope por cliente', () => {
  assert.equal(callsPerPhoto(config), 2);
  assert.equal(callsPerPhoto({ ...config, escalationModel: 'gemini-3-flash-preview' }), 3);
  // 1700 + 800 tokens a 0.25/1.5 USD por millón = 0.001625 por llamada; 2 llamadas × 1.5 de margen.
  assert.ok(Math.abs(estimatedPhotoCostUsd(config) - 0.004875) < 1e-9);
  const thousand = scaledRunLimits(1000, config, { maxCalls: 300, budgetUsd: 2 });
  assert.equal(thousand.maxCalls, 2050, 'Ya no se detiene cerca de la foto 300');
  assert.ok(thousand.budgetUsd > 5 && thousand.budgetUsd < 6, String(thousand.budgetUsd));
  const small = scaledRunLimits(10, config, { maxCalls: 300, budgetUsd: 2 });
  assert.deepEqual(small, { maxCalls: 300, budgetUsd: 2 }, 'Un lote pequeño conserva el piso configurado');
  const capped = scaledRunLimits(20_000, { ...config, maxCallsCap: 6000, budgetCapUsd: 25 }, { maxCalls: 300, budgetUsd: 2 });
  assert.deepEqual(capped, { maxCalls: 6000, budgetUsd: 25 }, 'Nunca supera los máximos del cliente');
  const defaults = scaledRunLimits(20_000, config, { maxCalls: 300, budgetUsd: 2 });
  assert.deepEqual(defaults, { maxCalls: DEFAULT_MAX_CALLS_CAP, budgetUsd: DEFAULT_BUDGET_CAP_USD });
  assert.deepEqual(scaledRunLimits(5, config, { maxCalls: 900, budgetUsd: 7 }), { maxCalls: 900, budgetUsd: 7 }, 'No reduce lo que la ejecución ya tenía');
});

test('punto 5: 500 artículos se reparten en trabajos que caben en un documento', () => {
  assert.equal(ORGANIZER_MAX_ARTICLES, 500);
  assert.ok(ORGANIZER_MAX_INPUT_IMAGES >= 500 * 4);
  const items = Array.from({ length: 500 }, (_, index) => index);
  assert.equal(chunkArticles(items, ORGANIZER_ARTICLES_PER_JOB.product).length, 13);
  assert.equal(chunkArticles(items, ORGANIZER_ARTICLES_PER_JOB.garment).length, 17);
  assert.deepEqual(chunkArticles(items, 40).flat(), items, 'Sin pérdidas ni duplicados');
  assert.ok(ORGANIZER_ARTICLES_PER_JOB.product <= 40, 'createProductGenerationBatch admite 40 objetos por lote');
  assert.ok(ORGANIZER_ARTICLES_PER_JOB.garment * 20_000 < 1_000_000 * 0.7, '~20 KB de plan de fotos por prenda en el documento');
  assert.ok(ORGANIZER_ARTICLES_PER_JOB.product * 6 <= 2000, 'Un trabajo de objetos queda muy por debajo de batchMaxJobs');
  const images = Array.from({ length: 1200 }, (_, index) => ({ itemId: `item-${Math.floor(index / 3)}`, fileName: `${index}.jpg`, storagePath: `garments/drafts/u/organizer-x/${index}.jpg` }));
  assert.equal(validateAutomationInput({ source: 'api', jobType: 'product', externalId: 'x', clientId: 'c', inputImages: images }, 'u', ORGANIZER_MAX_INPUT_IMAGES).inputImages.length, 1200);
  assert.throws(() => validateAutomationInput({ source: 'api', jobType: 'product', externalId: 'x', clientId: 'c', inputImages: images.slice(0, 41) }, 'u'), /Máximo 40/, 'La API externa conserva 40');
});

test('punto 7: máximo por cliente sin tocar el global', () => {
  const global = DEFAULT_AUTOMATION_BUDGET;
  assert.equal(effectiveMaxBudgetUsd(global, {}), 100);
  assert.equal(effectiveMaxBudgetUsd(global, { maxBudgetUsd: 1500 }), 1500);
  assert.equal(resolveAutomationPolicy(global, { maxBudgetUsd: 1500 }, { budgetUsd: 1200 }).budgetUsd, 1200);
  assert.throws(() => resolveAutomationPolicy(global, {}, { budgetUsd: 1200 }), /máximo global/, 'Los demás clientes conservan el máximo global');
  assert.throws(() => resolveAutomationPolicy(global, { maxBudgetUsd: 50 }, { budgetUsd: 60 }), /máximo del cliente/, 'Un máximo menor también limita');
  assert.equal(validateClientMaxBudget(1500, 10), 1500);
  assert.throws(() => validateClientMaxBudget(0), /entre 0.01/);
  assert.throws(() => validateClientMaxBudget(20_000), /entre 0.01/);
  assert.throws(() => validateClientMaxBudget(12.345), /entre 0.01/);
  assert.throws(() => validateClientMaxBudget(50, 60), /no puede superar/);
  // 30 prendas a USD 10 por artículo caben con un máximo de cliente de 300; con el global se recortarían a 100.
  assert.equal(organizerAutomationBudget(30, 10, effectiveMaxBudgetUsd(global, { maxBudgetUsd: 300 })), 300);
  assert.equal(organizerAutomationBudget(30, 10, effectiveMaxBudgetUsd(global, {})), 100);
});

test('puntos 8 y 9: límites de exportación y trabajo paralelo con plazo', async () => {
  assert.ok(EXPORT_LIMITS.jobs >= 1000 * 6, '1000 fotos de objetos × 6 escenas');
  assert.ok(EXPORT_LIMITS.batches >= 20);
  assert.ok(EXPORT_LIMITS.cells <= 500_000, 'Medido: 498 000 celdas ≈ 22 s y ~680 MB');
  const seen: number[] = [];
  assert.equal(await inParallel([1, 2, 3, 4, 5], 2, Date.now() + 60_000, async (item: number) => { seen.push(item); }), true);
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5]);
  assert.equal(await inParallel([1, 2, 3], 2, Date.now() - 1, async () => { throw new Error('no debe ejecutarse'); }), false);
});
