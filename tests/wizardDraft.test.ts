import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const draftModule = require('../src/features/generate/wizard/draft.ts') as typeof import('../src/features/generate/wizard/draft');
const { createInitialGenerateWizardState, getGenerateWizardLastAccessibleStep } = require('../src/features/generate/wizard/state.ts') as typeof import('../src/features/generate/wizard/state');
const {
  WIZARD_DRAFT_TTL_MS, clearWizardDrafts, parseWizardDraft, restoreWizardDraft, serializeWizardDraft, wizardDraftKey, collectWizardDraftPaths,
} = draftModule;
type WizardState = ReturnType<typeof createInitialGenerateWizardState>;
type Garment = WizardState['garments'][number];
type Catalog = Parameters<typeof restoreWizardDraft>[1];

const UID = 'alice';
const BATCH = 'draft-1';
const NOW = Date.UTC(2026, 10, 16, 12);
const clean = { prompt: false, promptBlocks: false, productScenes: false };
const path = (garmentId: string, index: number) => `garments/drafts/${UID}/${BATCH}/${garmentId}/${index}.jpg`;

const garment = (id: string, overrides: Partial<Garment> = {}, uploaded = true): Garment => {
  const photos = [0, 1].map((index) => ({
    id: `${id}-p${index}`,
    file: { name: `${id}-${index}.jpg` } as File,
    fileName: `${id}-${index}.jpg`,
    sourceIndex: index,
    previewUrl: `blob:local/${id}-${index}`,
    upload: uploaded
      ? { status: 'uploaded' as const, progress: 100, attempts: 1, error: null, storagePath: path(id, index), draftBatchId: BATCH }
      : { status: 'uploading' as const, progress: 40, attempts: 1, error: null, storagePath: index === 0 ? path(id, 0) : null, draftBatchId: null },
    classification: { status: 'classified' as const, view: index === 0 ? 'front' as const : 'back' as const, confidence: 0.9, reasoning: 'ok', classifiedBy: 'gemini' as const, error: null },
  }));
  return {
    id, name: `Prenda ${id}`, sourceType: 'single' as Garment['sourceType'], files: photos.map((photo) => photo.file!), previewUrl: photos[0].previewUrl,
    isMultiAngle: true, originalFileNames: photos.map((photo) => photo.fileName), originalPhotos: photos,
    upload: uploaded
      ? { status: 'uploaded', progress: 100, attempts: 1, error: null, storagePath: path(id, 0), draftBatchId: BATCH }
      : { status: 'uploading', progress: 40, attempts: 1, error: null, storagePath: null, draftBatchId: null },
    analysisStatus: 'ready', itemKind: 'garment', itemKindConfidence: 0.95, garmentBodyArea: 'upper_body', ...overrides,
  };
};

const garmentState = (overrides: Partial<WizardState> = {}): WizardState => ({
  ...createInitialGenerateWizardState(),
  step: 3,
  generationKind: 'garment',
  selectedClientId: 'client-1',
  selectedModelId: 'model-1',
  selectedPoseIds: ['pose-1', 'pose-2'],
  garments: [garment('g1'), garment('g2')],
  poseSuggestions: { status: 'ready', error: null, suggestedPoseIds: ['pose-1', 'pose-2'], signature: 'sig', missingPoseClassificationCount: 0 },
  prompt: 'Prompt editado',
  ...overrides,
});

const catalog = (overrides: Partial<Catalog> = {}): Catalog => ({
  clients: [{ id: 'client-1', name: 'Cliente' }],
  models: [{ id: 'model-1', name: 'Modelo', poses: [{ id: 'pose-1' }, { id: 'pose-2' }] as Catalog['models'][number]['poses'] }],
  templates: null,
  categories: null,
  paths: new Map(['g1', 'g2'].flatMap((id) => [0, 1].map((index) => [path(id, index), { status: 'ok' as const, url: `https://storage.test/${id}/${index}` }]))),
  ...overrides,
});

const roundTrip = (state: WizardState, extra: Partial<Parameters<typeof serializeWizardDraft>[0]> = {}) => {
  const draft = serializeWizardDraft({ state, draftBatchId: BATCH, dirty: clean, scope: 'generate', submitting: false, now: NOW, ...extra });
  assert.ok(draft);
  const parsed = parseWizardDraft(JSON.parse(JSON.stringify(draft)), { uid: UID, scope: 'generate', now: NOW + 1000 });
  assert.ok(parsed, 'a fresh draft parses');
  return parsed;
};

test('serialized drafts keep ids, paths and settings but never File objects or blob URLs', () => {
  const draft = serializeWizardDraft({ state: garmentState(), draftBatchId: BATCH, dirty: { ...clean, prompt: true }, scope: 'generate', submitting: false, now: NOW });
  const json = JSON.stringify(draft);
  assert.doesNotMatch(json, /blob:/);
  assert.equal(json.includes('"files"'), false);
  assert.equal(json.includes('"file"'), false);
  assert.equal(json.includes('"previewUrl"'), false);
  assert.deepEqual(draft?.garments[0].originalPhotos.map((photo) => photo.storagePath), [path('g1', 0), path('g1', 1)]);
  assert.equal(draft?.state.prompt, 'Prompt editado');
  assert.equal(draft?.dirty.prompt, true);
  assert.equal('marketplacePhotoPlan' in (draft?.state ?? {}), false, 'the plan is derived again on restore');
});

test('empty wizard produces no draft', () => {
  assert.equal(serializeWizardDraft({ state: createInitialGenerateWizardState(), draftBatchId: null, dirty: clean, scope: 'generate', submitting: false, now: NOW }), null);
});

test('uploads in progress are not saved as finished; finished ones are', () => {
  const draft = roundTrip(garmentState({ garments: [garment('g1'), garment('g2', {}, false)] }));
  assert.deepEqual(draft.garments.map((entry) => entry.id), ['g1']);
  assert.deepEqual(draft.incompleteGarmentNames, ['Prenda g2']);
  const restored = restoreWizardDraft(draft, catalog(), createInitialGenerateWizardState());
  assert.deepEqual(restored.state.garments.map((entry) => entry.id), ['g1']);
  assert.match(restored.warnings.join(' '), /No terminaron de subirse.*Prenda g2/);
});

test('work in flight is redone instead of being restored as finished', () => {
  const state = garmentState({
    garments: [garment('g1', { analysisStatus: 'preparing' })],
    poseSuggestions: { status: 'preparing', error: null, suggestedPoseIds: [], signature: 'x', missingPoseClassificationCount: 0 },
    productDraftPreparation: { status: 'preparing', error: null, signature: 'y' },
    productDrafts: [{ garmentId: 'g1', garmentName: 'Prenda g1', categoryId: 'c', categoryName: 'C', rows: [] }],
    sourceSpreadsheet: { originalFileName: 'fuente.xlsx', storagePath: null, status: 'uploading', error: null },
  });
  const draft = roundTrip(state);
  assert.equal(draft.garments[0].analysisStatus, 'idle');
  assert.equal(draft.state.poseSuggestions.status, 'idle');
  assert.equal(draft.state.productDraftPreparation.status, 'idle');
  assert.deepEqual(draft.state.productDrafts, []);
  assert.equal(draft.state.sourceSpreadsheet, null);
});

test('a valid draft restores the same step, selections and Storage-backed previews', () => {
  const restored = restoreWizardDraft(roundTrip(garmentState(), { dirty: { ...clean, prompt: true } }), catalog(), createInitialGenerateWizardState());
  assert.deepEqual(restored.warnings, []);
  assert.equal(restored.state.step, 3);
  assert.equal(restored.state.selectedClientId, 'client-1');
  assert.equal(restored.state.selectedModelId, 'model-1');
  assert.deepEqual(restored.state.selectedPoseIds, ['pose-1', 'pose-2']);
  assert.equal(restored.state.poseSuggestions.status, 'ready');
  assert.equal(restored.state.prompt, 'Prompt editado');
  assert.equal(restored.dirty.prompt, true);
  assert.equal(restored.draftBatchId, BATCH);
  const [first] = restored.state.garments;
  assert.equal(first.previewUrl, 'https://storage.test/g1/0');
  assert.equal(first.originalPhotos[0].file, null);
  assert.equal(first.originalPhotos[1].classification.view, 'back');
  assert.equal(first.upload.status, 'uploaded');
  assert.equal(first.upload.draftBatchId, BATCH);
  assert.equal(getGenerateWizardLastAccessibleStep(restored.state), 3, 'restored garment flow reaches step 3');
});

test('product and marketplace-only fields survive the round trip', () => {
  const productState = garmentState({
    generationKind: 'product', selectedModelId: null, selectedPoseIds: [],
    garments: [garment('g1', { itemKind: 'product', photoProductId: 'p-1', photoVariantId: 'v-1', photoAttributes: { color: 'Rojo' } as unknown as Garment['photoAttributes'] })],
    productScenes: [{ type: 'hero', prompt: 'Escena editada' }],
    provider: 'fal-nano-banana-2',
  });
  const restored = restoreWizardDraft(roundTrip(productState, { dirty: { ...clean, productScenes: true } }), catalog(), createInitialGenerateWizardState());
  assert.deepEqual(restored.state.productScenes, [{ type: 'hero', prompt: 'Escena editada' }]);
  assert.equal(restored.state.provider, 'fal-nano-banana-2');
  assert.equal(restored.state.garments[0].photoVariantId, 'v-1');
  assert.deepEqual(restored.state.garments[0].photoAttributes, { color: 'Rojo' });
  assert.equal(restored.dirty.productScenes, true);
  assert.equal(getGenerateWizardLastAccessibleStep(restored.state), 3);
});

test('missing client drops client-bound selections and warns', () => {
  const restored = restoreWizardDraft(roundTrip(garmentState()), catalog({ clients: [], models: [] }), createInitialGenerateWizardState());
  assert.equal(restored.state.selectedClientId, null);
  assert.equal(restored.state.selectedModelId, null);
  assert.deepEqual(restored.state.selectedPoseIds, []);
  assert.equal(restored.state.garments.length, 2, 'uploaded photos stay usable with another client');
  assert.match(restored.warnings.join(' '), /cliente guardado ya no está disponible/);
  assert.equal(getGenerateWizardLastAccessibleStep(restored.state), 1);
});

test('inactive model and inactive poses are dropped with a warning', () => {
  const noModel = restoreWizardDraft(roundTrip(garmentState()), catalog({ models: [] }), createInitialGenerateWizardState());
  assert.equal(noModel.state.selectedModelId, null);
  assert.deepEqual(noModel.state.selectedPoseIds, []);
  assert.match(noModel.warnings.join(' '), /modelo guardado ya no está activo/);

  const onePose = restoreWizardDraft(roundTrip(garmentState()), catalog({
    models: [{ id: 'model-1', name: 'Modelo', poses: [{ id: 'pose-2' }] as Catalog['models'][number]['poses'] }],
  }), createInitialGenerateWizardState());
  assert.deepEqual(onePose.state.selectedPoseIds, ['pose-2']);
  assert.equal(onePose.state.poseSuggestions.status, 'idle', 'suggestions are recomputed for the new pose set');
  assert.match(onePose.warnings.join(' '), /1 pose\(s\)/);
});

test('garments whose files no longer exist are dropped; unverifiable ones are kept', () => {
  const paths = catalog().paths;
  paths.set(path('g2', 1), { status: 'missing' });
  paths.set(path('g1', 0), { status: 'error' });
  const restored = restoreWizardDraft(roundTrip(garmentState()), catalog({ paths }), createInitialGenerateWizardState());
  assert.deepEqual(restored.state.garments.map((entry) => entry.id), ['g1']);
  assert.equal(restored.state.garments[0].previewUrl, '');
  assert.match(restored.warnings.join(' '), /Prenda g2 ya no existen/);
  assert.match(restored.warnings.join(' '), /vista previa de Prenda g1/);
});

test('missing spreadsheet template or category falls back safely', () => {
  const spreadsheet = garmentState({
    outputMode: 'spreadsheet', selectedSpreadsheetTemplateId: 'tpl-1', selectedSpreadsheetCategoryId: 'cat-1',
    productDrafts: [{ garmentId: 'g1', garmentName: 'Prenda g1', categoryId: 'cat-1', categoryName: 'Cat', rows: [] }],
    productDraftPreparation: { status: 'ready', error: null, signature: 'drafts' },
  });
  const kept = restoreWizardDraft(roundTrip(spreadsheet), catalog({ templates: [{ id: 'tpl-1', name: 'T' }], categories: [{ id: 'cat-1' }] }), createInitialGenerateWizardState());
  assert.equal(kept.state.outputMode, 'spreadsheet');
  assert.equal(kept.state.productDrafts.length, 1);
  assert.equal(kept.state.productDraftPreparation.status, 'ready');

  const noTemplate = restoreWizardDraft(roundTrip(spreadsheet), catalog({ templates: [], categories: [] }), createInitialGenerateWizardState());
  assert.equal(noTemplate.state.outputMode, 'photos_only');
  assert.equal(noTemplate.state.selectedSpreadsheetTemplateId, null);
  assert.deepEqual(noTemplate.state.productDrafts, []);

  const noCategory = restoreWizardDraft(roundTrip(spreadsheet), catalog({ templates: [{ id: 'tpl-1', name: 'T' }], categories: [] }), createInitialGenerateWizardState());
  assert.equal(noCategory.state.selectedSpreadsheetCategoryId, null);
  assert.equal(noCategory.state.productDraftPreparation.status, 'idle');
});

test('a reload during batch creation warns about duplicates', () => {
  const restored = restoreWizardDraft(roundTrip(garmentState(), { submitting: true }), catalog(), createInitialGenerateWizardState());
  assert.match(restored.warnings.join(' '), /no duplicarlo/);
});

test('parse rejects expired, foreign, other-scope and tampered drafts', () => {
  const draft = JSON.parse(JSON.stringify(serializeWizardDraft({ state: garmentState(), draftBatchId: BATCH, dirty: clean, scope: 'generate', submitting: false, now: NOW })));
  assert.ok(parseWizardDraft(draft, { uid: UID, scope: 'generate', now: NOW + WIZARD_DRAFT_TTL_MS - 1 }));
  assert.equal(parseWizardDraft(draft, { uid: UID, scope: 'generate', now: NOW + WIZARD_DRAFT_TTL_MS + 1 }), null, 'expired');
  assert.equal(parseWizardDraft(draft, { uid: 'bob', scope: 'generate', now: NOW }), null, 'paths of another user');
  assert.equal(parseWizardDraft(draft, { uid: UID, scope: '["c","v","",""]', now: NOW }), null, 'other wizard scope');
  assert.equal(parseWizardDraft({ ...draft, version: 99 }, { uid: UID, scope: 'generate', now: NOW }), null, 'other version');
  const traversal = structuredClone(draft);
  traversal.garments[0].originalPhotos[0].storagePath = `garments/drafts/${UID}/${BATCH}/../../bob/x.jpg`;
  assert.equal(parseWizardDraft(traversal, { uid: UID, scope: 'generate', now: NOW }), null, 'path traversal');
  assert.equal(parseWizardDraft('not json object', { uid: UID, scope: 'generate', now: NOW }), null);
});

test('draft keys isolate project, user and scope; logout clears only that user', () => {
  const data = new Map<string, string>();
  const storage = { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key), clear: () => data.clear() } as Storage;
  storage.setItem(wizardDraftKey('p', 'alice', 'generate'), '1');
  storage.setItem(wizardDraftKey('p', 'alice', '["c"]'), '1');
  storage.setItem(wizardDraftKey('p', 'bob', 'generate'), '1');
  storage.setItem(wizardDraftKey('other', 'alice', 'generate'), '1');
  clearWizardDrafts('p', 'alice', storage);
  assert.deepEqual([...data.keys()].sort(), [wizardDraftKey('other', 'alice', 'generate'), wizardDraftKey('p', 'bob', 'generate')].sort());
});

test('collects every Storage path a draft depends on', () => {
  const draft = roundTrip(garmentState({ sourceSpreadsheet: { originalFileName: 'f.xlsx', storagePath: `wizard_source_spreadsheets/${UID}/u/f.xlsx`, status: 'uploaded', error: null } }));
  const paths = collectWizardDraftPaths(draft);
  assert.equal(paths.images.length, 4);
  assert.deepEqual(paths.files, [`wizard_source_spreadsheets/${UID}/u/f.xlsx`]);
});
