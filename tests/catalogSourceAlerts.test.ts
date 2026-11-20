import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-catalog-alerts', storageBucket: 'demo-catalog-alerts.appspot.com' });
const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
const exportsService = require('../functions/lib/functions/src/spreadsheets/marketplaceExportService.js');
const { readCatalogAlerts } = require('../functions/lib/functions/src/organizer/catalogAlerts.js') as typeof import('../functions/src/organizer/catalogAlerts');

// Isolated read-only store; no Firebase connection or mutations are provided.
test('catalog alerts preserve garment attribution, source photo links and actual export blocking severity', async () => {
  const originalDb = firestore.getAppFirestore;
  const originalContext = exportsService.loadExportContext;
  let confirmed = false;
  const docs: Record<string, any> = {
    'batches/batch': { clientId: 'jishop', automationJobId: 'auto' },
    'automationJobs/auto': { clientId: 'jishop', items: [{ itemId: 'item2', status: 'needs_attention', issue: { message: 'Clasificación incierta' } }] },
    'organizers/jishop/photos/front': { id: 'front', name: 'SINCOD_BUZO-TIEDYE_FRENTE_01.jpg', baseId: 'JST-M05', issue: 'Producto base JST-M05; variante por confirmar' },
  };
  const snapshot = (data: any) => ({ exists: Boolean(data), data: () => data, get: (field: string) => data?.[field] });
  firestore.getAppFirestore = () => ({
    doc: (path: string) => ({ get: async () => snapshot(docs[path]), collection: () => ({ get: async () => ({ docs: [snapshot({ itemId: 'item1', photos: [{ id: 'front' }] }), snapshot({ itemId: 'item2', photos: [], category: { categoryId: null, reason: 'Revisa la categoría' } })] }) }) }),
  });
  exportsService.loadExportContext = async () => ({ products: [{ garmentId: 'item1', organizer: { source: { issue: 'Sin coincidencia en Excel' }, confirmedIdentity: confirmed } }] });
  try {
    const result = await readCatalogAlerts('jishop', 'batch', 'operator');
    assert.deepEqual(result.alerts.find(alert => alert.severity === 'error'), { itemId: 'item1', severity: 'error', message: 'Sin coincidencia en Excel', photoId: 'front' });
    assert.ok(result.alerts.some(alert => alert.itemId === 'item1' && alert.photoId === 'front' && /Sin ficha comercial/.test(alert.message) && alert.severity === 'warning'));
    assert.ok(result.alerts.some(alert => alert.itemId === 'item2' && alert.message === 'Clasificación incierta' && alert.severity === 'warning'));
    confirmed = true;
    assert.equal((await readCatalogAlerts('jishop', 'batch', 'operator')).alerts.some(alert => alert.severity === 'error'), false);
    await assert.rejects(readCatalogAlerts('other-client', 'batch', 'operator'), /Lote no disponible/);
  } finally {
    firestore.getAppFirestore = originalDb;
    exportsService.loadExportContext = originalContext;
  }
});
