import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-sincod-followups', storageBucket: 'demo-sincod-followups.appspot.com' });
const { readOrganizerCommerce } = require('../functions/lib/functions/src/organizer/commerce.js') as typeof import('../functions/src/organizer/commerce');
const { identityConfirmed } = require('../functions/lib/functions/src/spreadsheets/marketplaceExportService.js') as typeof import('../functions/src/spreadsheets/marketplaceExportService');

const rootWith = (photos: Record<string, any>) => ({
  collection: () => ({ doc: (id: string) => ({ get: async () => ({ data: () => photos[id] }) }) }),
}) as any;

test('unlinked SINCOD photos mark their pending source; a drawer identity override cannot bypass it', async () => {
  const pending = await readOrganizerCommerce(rootWith({ front: { name: 'SINCOD_BUZO-TIEDYE_FRENTE_01.jpg', path: ['Origen', 'SINCOD_BUZO-TIEDYE_FRENTE_01.jpg'], version: 'v1', variantId: null } }),
    [{ id: 'front', version: 'v1' }] as any);
  assert.equal(pending.organizerVariantId, null);
  assert.equal(pending.source.pendingCommercialLink, 'SINCOD_BUZO-TIEDYE');
  assert.equal(identityConfirmed({ organizer: { source: pending.source, confirmedIdentity: true } }), false);

  const coded = await readOrganizerCommerce(rootWith({ front: { name: 'JST-M01_FRENTE_01.jpg', path: ['Origen', 'JST-M01_FRENTE_01.jpg'], version: 'v1', variantId: null } }),
    [{ id: 'front', version: 'v1' }] as any);
  assert.equal(coded.source.pendingCommercialLink, undefined);
  assert.equal(identityConfirmed({ organizer: { source: coded.source, confirmedIdentity: true } }), true);
  assert.equal(identityConfirmed({ organizer: { source: coded.source } }), false);
});
