import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { saveClientAutomation } = require('../functions/lib/functions/src/automation/clientConfig.js');
const { DEFAULT_AUTOMATION_BUDGET } = require('../functions/lib/shared/src/automationPolicy.js');
const { configSnapshot } = require('../functions/lib/shared/src/configSnapshot.js');

const fixture = () => {
  let automation = { enabled: true, driveFolderIds: ['folder-a'], defaultModelId: 'man', defaultMaleModelId: 'man', defaultFemaleModelId: 'woman', defaultBudgetUsd: 4, maxOperationalRetries: 2, presets: { custom: { prompt: 'Keep preset' } } };
  const models = ['man', 'woman'].map(id => ({ id, clientId: 'client', status: 'active', active: true, identityTraits: { sex: id === 'man' ? 'male' : 'female' }, poses: [] }));
  const writes: any[] = [];
  const reads: string[] = [];
  const snapshot = (path: string) => ({ exists: true, data: () => path === 'clients/client' ? { status: 'active', automation } : path === 'system_config/main' ? { automationBudget: DEFAULT_AUTOMATION_BUDGET } : path === 'organizers/client' ? { sourceIds: ['folder-a'] } : models.find(model => `models/${model.id}` === path) });
  const db = {
    collection: (name: string) => { reads.push(name); return ({ doc: (id: string) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }), where: () => ({ get: async () => ({ docs: name === 'models' ? models.map(model => ({ id: model.id, data: () => model })) : [] }) }) }); },
    runTransaction: async (fn: any) => fn({ get: async (ref: any) => ref.get(), getAll: async (...refs: any[]) => refs.map(ref => snapshot(ref.path)), update: (ref: any, patch: any) => { writes.push(patch); automation = patch.automation ?? { ...automation, driveFolderIds: patch['automation.driveFolderIds'] }; } }),
  };
  return { db, writes, reads, get automation() { return automation; } };
};
test('shared automation editor preserves folders, presets, model defaults and budgets with a baseline snapshot', async () => {
  const state = fixture(); const original = structuredClone(state.automation);
  const next = await saveClientAutomation({ clientId: 'client', expectedAutomation: original, automation: { ...original, defaultBudgetUsd: 6, driveFolderIds: undefined } }, state.db);
  assert.equal(next.defaultBudgetUsd, 6);
  for (const key of ['driveFolderIds', 'defaultModelId', 'defaultMaleModelId', 'defaultFemaleModelId', 'maxOperationalRetries', 'presets'] as const) assert.deepEqual(next[key], original[key]);
  assert.equal(state.writes.length, 1);
});
test('a stale baseline refuses a concurrent overwrite, including concurrent presets and folder changes', async () => {
  for (const patch of [{ defaultBudgetUsd: 7 }, { driveFolderIds: ['folder-b'] }, { presets: {} }]) {
    const state = fixture(); const stale = { ...state.automation, ...patch };
    await assert.rejects(() => saveClientAutomation({ clientId: 'client', expectedAutomation: stale, automation: { ...state.automation, driveFolderIds: undefined } }, state.db), { code: 'aborted' });
    assert.equal(state.writes.length, 0);
  }
  assert.equal(configSnapshot({ b: 2, a: { d: 4, c: 3 } }), configSnapshot({ a: { c: 3, d: 4 }, b: 2 }));
});
test('folder removal still refuses an Organizer source, without writing client config or global settings', async () => {
  const state = fixture();
  await assert.rejects(() => saveClientAutomation({ clientId: 'client', expectedAutomation: state.automation, automation: { ...state.automation, driveFolderIds: [] } }, state.db), { code: 'failed-precondition' });
  assert.equal(state.writes.length, 0);
});

test('sources only changes folders, preserving concurrent automation changes and never loading or inferring models', async t => {
  const { googleDrive } = require('../functions/lib/functions/src/automation/drive.js');
  t.mock.method(googleDrive, 'metadata', async () => ({ mimeType: 'application/vnd.google-apps.folder' }));
  const state = fixture(); const original = structuredClone(state.automation);
  const staleOtherTab = { ...original, defaultBudgetUsd: 2, presets: {} };
  const saved = await saveClientAutomation({ clientId: 'client', section: 'sources', expectedAutomation: staleOtherTab, automation: { driveFolderIds: ['folder-a', 'folder-b'] } }, state.db);
  assert.deepEqual(saved, { ...original, driveFolderIds: ['folder-a', 'folder-b'] });
  assert.deepEqual(state.automation, saved);
  assert.equal(state.reads.includes('models'), false);
  assert.deepEqual(Object.keys(state.writes[0]).sort(), ['automation.driveFolderIds', 'updatedAt']);
});
test('automation-only saves preserve concurrent folder changes; same-section conflicts still abort', async t => {
  const { googleDrive } = require('../functions/lib/functions/src/automation/drive.js');
  const metadata = t.mock.method(googleDrive, 'metadata', async () => { throw Error('Automation must not check Drive'); });
  const state = fixture(); const original = structuredClone(state.automation);
  const staleFolders = { ...original, driveFolderIds: ['other-folder'] };
  const { driveFolderIds, ...automation } = original;
  const saved = await saveClientAutomation({ clientId: 'client', section: 'automation', expectedAutomation: staleFolders, automation: { ...automation, defaultBudgetUsd: 6 } }, state.db);
  assert.equal(saved.defaultBudgetUsd, 6); assert.deepEqual(saved.driveFolderIds, ['folder-a']);
  assert.equal(metadata.mock.callCount(), 0);
  await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'automation', expectedAutomation: original, automation }, state.db), { code: 'aborted' });
});
test('sources retain Drive/Organizer protection and reject parameters belonging to the other tab', async () => {
  const state = fixture();
  await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'sources', automation: { driveFolderIds: [] } }, state.db), { code: 'failed-precondition' });
  await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'sources', automation: { enabled: false, driveFolderIds: [] } }, state.db), { code: 'invalid-argument' });
  await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'automation', automation: { enabled: true, driveFolderIds: [] } }, state.db), { code: 'invalid-argument' });
  await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'unknown', automation: {} }, state.db), { code: 'invalid-argument' });
  assert.equal(state.writes.length, 0);
});
test('partial draft acknowledgements and discards retain pending values and baselines in the other tab', () => {
  const { mergeClientAutomationSection } = require('../functions/lib/shared/src/clientAutomationSections.js');
  const base = { enabled: true, defaultBudgetUsd: 4, driveFolderIds: ['a'] };
  const pending = { ...base, defaultBudgetUsd: 6, driveFolderIds: ['a', 'b'] };
  const savedSources = { ...base, driveFolderIds: ['a', 'b'] };
  assert.deepEqual(mergeClientAutomationSection(pending, savedSources, 'sources'), pending);
  assert.deepEqual(mergeClientAutomationSection(base, savedSources, 'sources'), savedSources);
  const savedAutomation = { ...base, defaultBudgetUsd: 6 };
  assert.deepEqual(mergeClientAutomationSection(pending, savedAutomation, 'automation'), pending);
  assert.deepEqual(mergeClientAutomationSection(pending, base, 'sources'), savedAutomation);
});

test('decision rules and Organizer settings participate in automation dirty state, section merge and concurrency', async () => {
  const { selectClientAutomationSection, mergeClientAutomationSection } = require('../functions/lib/shared/src/clientAutomationSections.js');
  const state = fixture();
  const base = structuredClone(state.automation);
  for (const fields of [{ rules: { garmentGenderMinConfidence: 0.8 } }, { rules: { classificationMinConfidence: 0.9 } },
    { organizerGeneration: { enabled: false } }, { organizerGeneration: { preset: 'custom' } }]) {
    const pending = { ...base, ...fields };
    assert.notEqual(configSnapshot(selectClientAutomationSection(pending, 'automation')), configSnapshot(selectClientAutomationSection(base, 'automation')));
    assert.equal(configSnapshot(selectClientAutomationSection(pending, 'sources')), configSnapshot(selectClientAutomationSection(base, 'sources')));
    assert.deepEqual(mergeClientAutomationSection(pending, { ...base, driveFolderIds: ['new'] }, 'sources'), { ...pending, driveFolderIds: ['new'] });
    assert.deepEqual(mergeClientAutomationSection({ ...base, driveFolderIds: ['new'] }, pending, 'automation'), { ...pending, driveFolderIds: ['new'] });
    assert.deepEqual(mergeClientAutomationSection(pending, base, 'automation'), base);
    await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'automation', expectedAutomation: pending, automation: selectClientAutomationSection(base, 'automation') }, state.db), { code: 'aborted' });
  }
  assert.equal(state.writes.length, 0);
});
