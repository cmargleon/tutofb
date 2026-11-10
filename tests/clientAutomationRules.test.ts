import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { ClientAutomationConfig } from '../shared/src/types';

const require = createRequire(import.meta.url);
const { saveClientAutomation } = require('../functions/lib/functions/src/automation/clientConfig.js');
const fixture = () => {
  let automation: ClientAutomationConfig = { enabled: true, driveFolderIds: ['folder'], presets: { custom: { prompt: 'Fondo cálido' } } };
  const snapshot = (path: string) => ({ exists: true, data: () => path === 'clients/client' ? { status: 'active', automation } : {} });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }), where: () => ({ get: async () => ({ docs: [] }) }) }),
    runTransaction: async (work: any) => work({ getAll: async (...refs: any[]) => refs.map(ref => snapshot(ref.path)), update: (_ref: unknown, patch: any) => { automation = patch.automation ?? { ...automation, driveFolderIds: patch['automation.driveFolderIds'] }; } }),
  };
  return { db, get automation() { return automation; } };
};

test('saveClientAutomation rejects invalid rules and organizer presets without writing', async () => {
  for (const rules of [{ garmentGenderMinConfidence: 0.49 }, { classificationMinConfidence: 0.96 }, { garmentGenderMinConfidence: NaN }, { classificationMinConfidence: Infinity }, { classificationMinConfidence: '0.7' }, null, []]) {
    const state = fixture();
    await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'automation', automation: { enabled: true, rules } }, state.db), { code: 'invalid-argument' });
    assert.equal(state.automation.rules, undefined);
  }
  for (const organizerGeneration of [{ preset: 'missing' }, { preset: '' }, { enabled: 'false' }, { preset: 1 }, null, []]) {
    const state = fixture();
    await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'automation', automation: { enabled: true, organizerGeneration } }, state.db), { code: 'invalid-argument' });
    assert.equal(state.automation.organizerGeneration, undefined);
  }
});

test('saveClientAutomation saves rules/preset in automation and removal restores inheritance', async () => {
  for (const preset of ['standard', 'generic_product', 'custom']) {
    const state = fixture();
    const saved = await saveClientAutomation({ clientId: 'client', section: 'automation', automation: { enabled: true,
      presets: state.automation.presets, rules: { garmentGenderMinConfidence: 0.8, classificationMinConfidence: 0.7 }, organizerGeneration: { enabled: false, preset } } }, state.db);
    assert.deepEqual(saved.rules, { garmentGenderMinConfidence: 0.8, classificationMinConfidence: 0.7 });
    assert.deepEqual(saved.organizerGeneration, { enabled: false, preset });
    assert.deepEqual(saved.driveFolderIds, ['folder']);
    const inherited = await saveClientAutomation({ clientId: 'client', section: 'automation', automation: { enabled: true, rules: {}, organizerGeneration: {} } }, state.db);
    assert.equal(Object.hasOwn(inherited, 'rules'), false);
    assert.equal(Object.hasOwn(inherited, 'organizerGeneration'), false);
  }
});

test('source saves reject rules and organizer settings; concurrent automation changes are detected', async () => {
  for (const patch of [{ rules: { garmentGenderMinConfidence: 0.8 } }, { organizerGeneration: { enabled: false } }]) {
    const state = fixture();
    await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'sources', automation: { driveFolderIds: ['folder'], ...patch } }, state.db), { code: 'invalid-argument' });
    await assert.rejects(() => saveClientAutomation({ clientId: 'client', section: 'automation', expectedAutomation: { ...state.automation, ...patch }, automation: { enabled: true } }, state.db), { code: 'aborted' });
  }
});

test('system sanitization accepts partial rules, keeps omissions, and discards malformed values', () => {
  const { sanitizeSystemConfig } = require('../functions/lib/functions/src/admin/systemConfig.js');
  assert.equal(sanitizeSystemConfig({}).automationRules, undefined);
  assert.deepEqual(sanitizeSystemConfig({ automationRules: { garmentGenderMinConfidence: 0.8 } }).automationRules, { garmentGenderMinConfidence: 0.8 });
  assert.deepEqual(sanitizeSystemConfig({ automationRules: { classificationMinConfidence: 1 } }).automationRules, {});
});

test('updateSystemConfig validates rules and persists optional overrides through the admin callable', async t => {
  const roles = require('../functions/lib/functions/src/auth/roles.js');
  const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
  const system = require('../functions/lib/functions/src/admin/systemConfig.js');
  const { updateSystemConfig } = require('../functions/lib/functions/src/callables/updateSystemConfig.js');
  let saved: any;
  t.mock.method(roles, 'assertCallableRoles', async () => {});
  t.mock.method(firestore, 'getAppFirestore', () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ displayName: 'Admin' }) }) }) }) }));
  t.mock.method(system, 'getSystemConfigDocRef', () => ({ get: async () => ({ exists: true, data: () => ({ jobMaxRetries: 7 }) }), set: async (value: any) => { saved = value; } }));
  for (const value of [0.49, 0.96, Infinity, NaN, '0.8']) {
    await assert.rejects(() => updateSystemConfig.run({ auth: { uid: 'admin' }, data: { automationRules: { garmentGenderMinConfidence: value } } }), { code: 'invalid-argument' });
    assert.equal(saved, undefined);
  }
  const response = await updateSystemConfig.run({ auth: { uid: 'admin' }, data: { automationRules: { garmentGenderMinConfidence: 0.8 } } });
  assert.deepEqual(saved.automationRules, { garmentGenderMinConfidence: 0.8 });
  assert.equal(saved.jobMaxRetries, 7);
  assert.deepEqual(response.config.automationRules, saved.automationRules);
});
