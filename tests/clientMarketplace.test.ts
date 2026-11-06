import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { saveClientMarketplace, updateClientMarketplace } = require('../functions/lib/functions/src/callables/updateClientMarketplace.js');

const fixture = () => {
  const records: Record<string, any> = {
    a: { status: 'active', generationPromptBase: 'keep', automation: { enabled: true, driveFolderIds: ['folder'], defaultFemaleModelId: 'woman', defaultBudgetUsd: 4 }, marketplaces: { amazon: { enabled: false, settings: { region: 'MX', sellerId: 'seller', future: 'keep' }, authorizationRef: 'future-ref' }, shein: { enabled: true } } },
    b: { status: 'active', marketplaces: { amazon: { enabled: false } } },
    archived: { status: 'archived' },
  };
  const writes: any[] = [];
  const db = {
    collection: (name: string) => { assert.equal(name, 'clients'); return { doc: (id: string) => ({ id }) }; },
    runTransaction: async (fn: any) => fn({
      get: async (ref: any) => ({ exists: !!records[ref.id], data: () => records[ref.id] }),
      update: (ref: any, patch: any) => { writes.push({ ref, patch }); for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith('marketplaces.')) records[ref.id].marketplaces[key.split('.')[1]] = value;
        else records[ref.id][key] = value;
      } },
    }),
  };
  return { records, writes, db };
};

test('marketplace patches preserve other channels, settings, future metadata and client operations; target only requested client', async () => {
  const { records, writes, db } = fixture();
  const original = structuredClone(records.a);
  await saveClientMarketplace({ clientId: 'a', marketplaceId: 'amazon', enabled: true }, db);
  assert.equal(records.a.marketplaces.amazon.enabled, true);
  assert.deepEqual(records.a.marketplaces.amazon.settings, original.marketplaces.amazon.settings);
  assert.equal(records.a.marketplaces.amazon.authorizationRef, 'future-ref');
  await saveClientMarketplace({ clientId: 'a', marketplaceId: 'amazon', settings: { region: ' US ' } }, db);
  assert.equal(records.a.marketplaces.amazon.enabled, true);
  assert.equal(records.a.marketplaces.amazon.settings.region, 'US');
  assert.equal(records.a.marketplaces.amazon.settings.sellerId, 'seller');
  assert.deepEqual(records.a.marketplaces.shein, original.marketplaces.shein);
  assert.deepEqual(records.a.automation, original.automation);
  assert.equal(records.a.generationPromptBase, 'keep');
  assert.equal(records.b.marketplaces.amazon.enabled, false);
  assert.ok(writes.every(write => Object.keys(write.patch).every(key => key === 'marketplaces.amazon' || key === 'updatedAt')));
});
test('missing marketplace defaults disabled without a migration, and settings updates do not enable it', async () => {
  const { records, db } = fixture();
  await saveClientMarketplace({ clientId: 'a', marketplaceId: 'mercado-libre', settings: { sellerId: 'seller' } }, db);
  assert.equal(records.a.marketplaces['mercado-libre'].enabled, false);
});
test('rejects manipulated IDs, unknown channels, secret fields, invalid settings and unavailable clients without writing', async () => {
  const { db, writes } = fixture();
  for (const patch of [{ clientId: '../b' }, { marketplaceId: 'amazon.enabled' }, { enabled: 'true' }, { token: 'secret' }, { settings: { apiKey: 'secret' } }, { settings: { region: 'x'.repeat(81) } }, { settings: [] }, { settings: { region: null } }]) {
    await assert.rejects(() => saveClientMarketplace({ clientId: 'a', marketplaceId: 'amazon', enabled: true, ...patch }, db), { code: 'invalid-argument' });
  }
  for (const clientId of ['missing', 'archived']) await assert.rejects(() => saveClientMarketplace({ clientId, marketplaceId: 'amazon', enabled: true }, db), { code: 'not-found' });
  assert.equal(writes.length, 0);
});
test('marketplace callable requires authenticated current admin before client data access', async (t) => {
  const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
  let currentRole = 'operador';
  t.mock.method(firestore, 'getAppFirestore', () => ({ collection: (name: string) => {
    assert.equal(name, 'users');
    return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ active: true, role: currentRole }) }) }) };
  } }));
  await assert.rejects(() => updateClientMarketplace.run({ data: {} }), { code: 'unauthenticated' });
  for (const role of ['operador', 'revisor']) {
    currentRole = role;
    await assert.rejects(() => updateClientMarketplace.run({ data: {}, auth: { uid: 'user', token: { role: 'admin' } } }), { code: 'permission-denied' });
  }
});
