import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { MasterProduct, SpreadsheetTemplate, SpreadsheetTemplateCategory } from '../shared/src/types';
const require = createRequire(import.meta.url);
const { MARKETPLACE_ADAPTERS } = require('../functions/lib/shared/src/marketplaceExport/adapters.js');
const { askGeminiForChoices, planMarketplaceChoices, validateMarketplaceChoices } = require('../functions/lib/functions/src/spreadsheets/marketplaceAutofill.js');

const column = (key: string, label: string, index: number, extra: object) => ({ key, label, index, letter: String.fromCharCode(65 + index),
  required: false, requirementLabel: null, guidance: null, validation: 'list', ...extra });
// SHEIN-like category with a dependent list: the value options depend on the chosen specification.
const category: SpreadsheetTemplateCategory = { id: 'cat', templateId: 't', clientId: 'c', sheetName: 'Copa', label: 'Copa', rowStart: 5, attributes: [],
  validationMode: 'template', createdAt: null, updatedAt: null, columns: [
    column('sku', 'SKU', 0, { validation: null }),
    column('spec', 'Especificación 1', 1, { dropdownOptions: ['Capacidad(1000838)', 'Material(9)'] }),
    column('spec_value', 'Especificación 1 Contenido', 2, { required: true,
      dropdownDependency: { columnKey: 'spec', optionsByValue: { 'Capacidad(1000838)': ['500ml', '300ml'], 'Material(9)': ['Acero', 'Vidrio'] } } }),
    column('food', 'Materiales en contacto con alimentos', 3, { required: true, dropdownOptions: ['Acero Inoxidable', 'Vidrio'] }),
    column('pieces', 'Cantidad de piezas', 4, { dropdownOptions: ['1 pieza', '2 piezas'] }),
  ] } as any;
const template = { id: 't', clientId: 'c', exportConfig: { marketplaceId: 'shein', version: 1, operation: 'listing', validationStatus: 'compatible',
  validationMessages: [], mappings: { cat: { sku: { source: 'variant.sku' } } } } } as unknown as SpreadsheetTemplate;
const reason = 'Sugiere Acero Inoxidable por el acabado metálico; la composición del interior está por verificar.';
const product = (rows: Array<{ id: string; values: Record<string, string> }> = []): MasterProduct => ({
  id: 'p', clientId: 'c', batchIds: ['b'], garmentId: 'g', values: { name: 'COPA DESARMABLE' }, evidence: {}, legacyDrafts: [], originalImages: [],
  variants: [{ id: 'a200', values: { sku: 'A200' } }], approvedImages: [{ outputId: 'o', jobId: 'j', storagePath: 'generated/c/b/j/o.jpg' }], pendingImages: 0,
  marketplaces: { shein: { templateId: 't', categoryId: 'cat', rows } }, revision: 0,
  marketplaceAutofill: { shein: [{ id: 'a200', inferredFields: [], values: { spec: 'Capacidad(1000838)', spec_value: '500ml', food: 'Acero Inoxidable' },
    tentativeFields: ['spec', 'food'], reasons: { spec: 'La capacidad no está declarada.', food: reason },
    failures: { pieces: 'Gemini no devolvió una opción válida de la plantilla tras reintentarlo; elige una opción.' } }] },
});

test('valid low-certainty options are exported, warn with Gemini\'s reason and never block', () => {
  const result = MARKETPLACE_ADAPTERS.shein.prepare(product(), template, category);
  assert.deepEqual(result.rows[0].values, { sku: 'A200', spec: 'Capacidad(1000838)', spec_value: '500ml', food: 'Acero Inoxidable', pieces: '' });
  assert.deepEqual(result.issues.filter((issue: any) => issue.blocking !== false), []);
  const warnings = result.issues.filter((issue: any) => issue.code === 'verify_suggestion');
  // A child of an uncertain parent inherits the warning.
  assert.deepEqual(warnings.map((issue: any) => issue.field).sort(), ['food', 'spec', 'spec_value']);
  assert.ok(warnings.find((issue: any) => issue.field === 'food').message.endsWith(reason));
  const failed = result.issues.find((issue: any) => issue.code === 'autofill_failed');
  assert.equal(failed.field, 'pieces');
  assert.match(failed.message, /no devolvió una opción válida/);
});

test('manual corrections win, clear the warning and re-validate dependent lists', () => {
  const result = MARKETPLACE_ADAPTERS.shein.prepare(product([{ id: 'a200', values: { food: 'Vidrio', spec: 'Material(9)' } }]), template, category);
  assert.equal(result.rows[0].values.food, 'Vidrio');
  assert.equal(result.rows[0].values.spec, 'Material(9)');
  // Gemini's 500ml is not valid for Material: the dependent field goes back to pending instead of exporting an invalid value.
  assert.equal(result.rows[0].values.spec_value, '');
  assert.deepEqual(result.issues.filter((issue: any) => issue.code === 'verify_suggestion').map((issue: any) => issue.field), []);
  assert.ok(result.issues.some((issue: any) => issue.code === 'required' && issue.field === 'spec_value' && issue.blocking !== false));
});

test('the analysis plan ignores operator overrides so a correction keeps the cached analysis', () => {
  const plain = { ...product(), marketplaceAutofill: undefined };
  const corrected = { ...product([{ id: 'a200', values: { food: 'Vidrio' } }]), marketplaceAutofill: undefined };
  const plan = planMarketplaceChoices(plain, 'shein', template, category);
  assert.deepEqual(plan, planMarketplaceChoices(corrected, 'shein', template, category));
  assert.deepEqual(plan[0].fields.map((field: any) => field.key), ['spec', 'spec_value', 'food', 'pieces']);
});

test('Gemini must pick a valid option per row; one automatic retry covers errors and invalid answers', async () => {
  const [{ fields }] = planMarketplaceChoices({ ...product(), marketplaceAutofill: undefined }, 'shein', template, category);
  const answer = (key: string, value: string, confidence = 0.3) => ({ key, value, source: 'estimate', evidence: `Motivo ${key}`, confidence });
  const requests: string[][] = [];
  let attempt = 0;
  const choices = await askGeminiForChoices({ product: product() }, fields, [], {}, async (_input: unknown, asked: any[], _images: unknown, _options: unknown, chosen: object) => {
    requests.push(asked.map(field => field.key));
    if (attempt++ === 0) throw new Error('Gemini respondió con status 503.');
    if (attempt === 2) return [answer('spec', 'Capacidad(1000838)'), answer('spec_value', 'Acero'), answer('food', 'Acero Inoxidable', 0.6), answer('pieces', '3 piezas')];
    assert.deepEqual(chosen, { spec: 'Capacidad(1000838)', food: 'Acero Inoxidable' });
    return [answer('spec_value', '500ml'), answer('pieces', 'tres')];
  });
  assert.deepEqual(requests, [['spec', 'spec_value', 'food', 'pieces'], ['spec', 'spec_value', 'food', 'pieces'], ['spec_value', 'pieces']]);
  assert.deepEqual(choices.choices.map((choice: any) => [choice.key, choice.value, choice.tentative]),
    [['spec', 'Capacidad(1000838)', true], ['food', 'Acero Inoxidable', true], ['spec_value', '500ml', true]]);
  assert.deepEqual(Object.keys(choices.failures), ['pieces']);
  await assert.rejects(() => askGeminiForChoices({ product: product() }, fields, [], {}, async () => { throw new Error('caído'); }), /caído/);
});

test('choices outside the row options or the parent list are rejected; missing evidence still keeps a valid option', () => {
  const [{ fields }] = planMarketplaceChoices({ ...product(), marketplaceAutofill: undefined }, 'shein', template, category);
  const valid = validateMarketplaceChoices(fields, [
    { key: 'spec', value: 'Material(9)', source: 'estimate', evidence: '', confidence: 0.2 },
    { key: 'spec', value: 'Capacidad(1000838)', source: 'estimate', evidence: 'Duplicado', confidence: 0.9 },
    { key: 'spec_value', value: '500ml', source: 'estimate', evidence: 'No pertenece a Material', confidence: 0.9 },
    { key: 'food', value: 'Plástico', source: 'estimate', evidence: 'Fuera de la lista', confidence: 0.9 },
  ], false);
  assert.deepEqual(valid.map((choice: any) => [choice.key, choice.value]), [['spec', 'Material(9)']]);
  assert.match(valid[0].evidence, /no indicó el motivo/);
});
