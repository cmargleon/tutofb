import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { clientDraftKey, clearClientDrafts, readClientDraft, isAutomationDraft } = createRequire(import.meta.url)('../src/features/clients/draftStorage.ts') as typeof import('../src/features/clients/draftStorage');
const { changedFields } = createRequire(import.meta.url)('../functions/lib/shared/src/fieldConcurrency.js');

test('session drafts isolate project, identity, client and section; logout removes only its session drafts', () => {
  const data = new Map<string,string>();
  const storage = { clear: () => data.clear(), get length() { return data.size; }, key: (index: number) => [...data.keys()][index], getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) } as Storage;
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
  const remote = { name: 'Original', prompt: '' };
  const key = clientDraftKey('project', 'alice', 'client:settings');
  const saved = { version: 2, base: remote, value: { ...remote, name: 'Draft' } };
  storage.setItem(key, JSON.stringify(saved));
  assert.equal(readClientDraft(key, remote).value.name, 'Draft');
  for (const other of [clientDraftKey('other', 'alice', 'client:settings'), clientDraftKey('project', 'bob', 'client:settings'), clientDraftKey('project', 'alice', 'other:settings'), clientDraftKey('project', 'alice', 'client:marketplace:amazon')])
    assert.deepEqual(readClientDraft(other, remote).value, remote);
  const otherSection = clientDraftKey('project', 'alice', 'client:marketplace:shein'); storage.setItem(otherSection, JSON.stringify(saved));
  storage.removeItem(key); assert.ok(storage.getItem(otherSection));
  storage.setItem(key, '{broken'); assert.deepEqual(readClientDraft(key, remote).value, remote);
  storage.setItem(key, JSON.stringify({ version: 2, base: {}, value: [] })); assert.deepEqual(readClientDraft(key, remote).value, remote);
  const bob = clientDraftKey('project', 'bob', 'client:settings'); storage.setItem(bob, JSON.stringify(saved));
  storage.setItem('tuto:client-draft:legacy', 'legacy'); clearClientDrafts('project', 'alice', storage);
  assert.equal(storage.getItem(key), null); assert.equal(storage.getItem(otherSection), null); assert.equal(storage.getItem('tuto:client-draft:legacy'), null);
  assert.ok(storage.getItem(bob));
});
test('save patches contain only edited fields', () => {
  assert.deepEqual(changedFields({ region: 'MX', sellerId: 'old' }, { region: 'US', sellerId: 'old' }), { region: 'US' });
});

test('malformed optional automation drafts cannot break nested form controls', () => {
  assert.equal(isAutomationDraft({ driveFolderIds: 'invalid' }), false);
  assert.equal(isAutomationDraft({ presets: { bad: { poseIds: 42 } } }), false);
  assert.equal(isAutomationDraft({ presets: { bad: { imageConfig: [] } } }), false);
  assert.equal(isAutomationDraft({ presets: { valid: { poseIds: ['pose'], provider: 'fal-gpt-image-2.5-flare' } } }), true);
});
