import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { groupGenerationSources, selectGenerationReferences, type GenerationSource } from '../functions/lib/functions/src/organizer/automation.js';
import type { StoredRun } from '../functions/src/organizer/store';

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const source = (id: string, options: Partial<GenerationSource['photo']> = {}): GenerationSource => ({
  entry: { id, name: `${id}.jpg`, mimeType: 'image/jpeg', parents: ['product-folder'], path: ['Origen', 'Producto', `${id}.jpg`], sourceId: 'origin', version: '1', md5Checksum: id },
  photo: { id, name: `${id}.jpg`, path: ['Origen', 'Producto', `${id}.jpg`], sourceUrl: '', copyUrl: `https://drive.google.com/open?id=copy-${id}`,
    variantId: null, candidates: [], method: 'sin_asociar', evidence: [], confidence: 0, issue: 'Sin coincidencia en el Excel', duplicateOf: null,
    reviewedBy: null, view: 'front', kind: 'product', quality: 0.9, visualConfidence: 0.95,
    visualHint: { groupId: 'bottle-blue', label: 'Botella', color: 'Azul', pack: '', kind: 'product' }, ...options },
});

test('agrupa tres fotos del mismo producto sin match y prioriza la mejor referencia frontal', () => {
  const inputs = [source('front-low', { quality: 0.8 }), source('side', { view: 'side', quality: 0.99 }), source('front-high', { quality: 0.95 })];
  const groups = groupGenerationSources(inputs);
  assert.equal(groups.length, 1);
  const selected = selectGenerationReferences(groups[0].photos, 0.75)!;
  assert.equal(selected.kind, 'product');
  assert.equal(selected.references[0].entry.id, 'front-high');
  assert.equal(selected.references.length, 2);
  assert.deepEqual(selectGenerationReferences([source('front-low', { quality: 0.8 }), source('front-high', { quality: 0.95 }), source('front-mid')], 0.75)?.references.map(item => item.entry.id), ['front-high']);
});

test('no mezcla carpetas ni variantes y no exige aprobación de referencias del Excel', () => {
  const a = source('a');
  const b = source('b'); b.entry.parents = ['different-folder'];
  const c = source('c', { variantId: 'known-one' });
  const d = source('d', { variantId: 'known-two' });
  assert.equal(groupGenerationSources([a, b, c, d]).length, 4);
  assert.ok(selectGenerationReferences([c], 0.75));
});

test('conserva frente y espalda de ropa y requiere revisión ante tipos contradictorios o baja confianza', () => {
  const front = source('front', { kind: 'garment', quality: 0.8 });
  const back = source('back', { kind: 'garment', view: 'back', quality: 0.9 });
  assert.deepEqual(selectGenerationReferences([back, front], 0.75)?.references.map(item => item.entry.id), ['front', 'back']);
  assert.equal(selectGenerationReferences([front, source('object')], 0.75), null);
  assert.equal(selectGenerationReferences([source('uncertain', { visualConfidence: 0.4 })], 0.75), null);
  assert.equal(selectGenerationReferences([source('unknown', { kind: 'unknown' })], 0.75), null);
});

const local = [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_STORAGE_EMULATOR_HOST]
  .every(value => /^((127\.0\.0\.1)|localhost):\d+$/.test(value || ''));
test('handoff incremental: sin Excel crea las seis escenas, no repite y recupera una interrupción', { skip: !local, timeout: 120_000 }, async ({ mock }) => {
  const admin = requireFunctions('firebase-admin');
  const app = admin.initializeApp({ projectId: 'demo-organizer-handoff', storageBucket: 'demo-organizer-handoff.appspot.com' });
  const sharp = requireFunctions('sharp');
  const { automateNewPhotos } = requireFunctions('./lib/functions/src/organizer/automation.js');
  const { defaultConfig } = requireFunctions('./lib/functions/src/organizer/store.js');
  const { digest } = requireFunctions('./lib/functions/src/organizer/drive.js');
  const worker = requireFunctions('./lib/functions/src/automation/worker.js');
  const persistence = requireFunctions('./lib/functions/src/automation/persistence.js');
  const { updateSystemConfig } = requireFunctions('./lib/functions/src/callables/updateSystemConfig.js');
  const db = admin.firestore();
  const root = db.collection('organizers').doc('handoff-client');
  const doc = root.collection('runs').doc('first');
  const uid = 'handoff-operator';
  const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'blue' } }).jpeg().toBuffer();
  const originals: string[] = [];
  let copiesVerified = 0;
  const drive = {
    managed: async () => { copiesVerified++; }, verifyCopy: async () => { copiesVerified++; },
    image: async (id: string) => { originals.push(id); assert.ok(id.startsWith('copy-')); return jpeg; },
  };
  const config = { ...defaultConfig(root.id, 'Cliente', { sourceIds: ['origin'], parentId: 'parent', folderName: 'Organizado', enabled: true,
    debounceMinutes: 2, budgetUsd: 40, model: 'gemini-3.1-flash-lite', escalationModel: null, minimumConfidence: 0.75,
    controlSheet: false, allowInheritedAccess: false, operatorUids: [uid], directories: {} }), generationActor: { uid, delegated: null } };
  const makeRun = (id: string): StoredRun => ({ id, clientId: root.id, mode: 'sync', status: 'running', phase: 'automation',
    createdAt: Date.now(), updatedAt: Date.now(), completedAt: null, createdBy: 'watcher', budgetUsd: 40, estimatedUsd: 0, reservedUsd: 0,
    uncertainUsd: 0, alerts: [], calls: 0, counts: {}, error: null, reportUrl: null, controlSheetUrl: null,
    cursor: null, lease: 'lease', leaseUntil: Date.now() + 120_000, fingerprint: 'inventory', variantId: null, photoIds: [], delegated: null, rootId: 'organized', generationUid: uid });
  const insert = async (item: GenerationSource, added = true) => {
    await doc.collection('files').doc(item.entry.id).set({ entry: item.entry, added });
    await root.collection('photos').doc(item.entry.id).set(item.photo);
    await root.collection('manifest').doc(digest([item.entry.id, item.entry.version])).set({ copiedId: `copy-${item.entry.id}`, parentId: 'managed-folder' });
  };
  try {
    await db.collection('users').doc(uid).set({ uid, active: true, role: 'operador' });
    await db.collection('clients').doc(root.id).set({ name: 'Cliente', status: 'active', batchCount: 0, automation: { enabled: true } });
    const system = db.collection('system_config').doc('main');
    await system.set({ batchMaxJobs: 100, jobMaxRetries: 7 });
    await root.set(config);
    const run = makeRun(doc.id);
    await doc.set(run);
    for (const item of [source('front-low', { quality: 0.8 }), source('side', { view: 'side' }), source('front-high', { quality: 0.99 }), source('uncertain', { kind: 'unknown', visualHint: undefined })]) {
      // Firestore intentionally rejects undefined values.
      await insert(JSON.parse(JSON.stringify(item)));
    }
    // A previously inventoried photo must not be picked up on deployment.
    await insert(source('old', { visualHint: { groupId: 'old', label: 'Antigua', color: '', pack: '', kind: 'product' } }), false);
    await assert.rejects(() => updateSystemConfig.run({ data: { organizerAutoGenerationEnabled: false }, auth: { uid, token: { role: 'operador' } } }), { code: 'permission-denied' });
    await assert.rejects(() => updateSystemConfig.run({ data: { organizerAutoGenerationEnabled: 'false' }, auth: { uid: 'admin', token: { role: 'admin' } } }), { code: 'invalid-argument' });
    await updateSystemConfig.run({ data: { organizerAutoGenerationEnabled: false }, auth: { uid: 'admin', token: { role: 'admin' } } });
    await automateNewPhotos(drive, root, doc, config, run, 'lease', Date.now() + 60_000);
    assert.equal((await db.collection('automationJobs').get()).size, 0, 'El interruptor desactivado impide enviar trabajos');
    assert.equal((await root.collection('generationSources').get()).size, 0);
    assert.equal((await doc.get()).data().counts.automationSkippedPhotos, 4);
    assert.equal(copiesVerified, 0, 'Desactivar evita incluso la importación a Storage');
    await updateSystemConfig.run({ data: { organizerAutoGenerationEnabled: true }, auth: { uid: 'admin', token: { role: 'admin' } } });
    assert.equal((await system.get()).data().jobMaxRetries, 7, 'El interruptor conserva los parámetros de cola');
    await db.collection('clients').doc(root.id).update({ 'automation.enabled': false });
    await automateNewPhotos(drive, root, doc, config, run, 'lease', Date.now() + 60_000);
    assert.equal((await db.collection('automationJobs').get()).size, 0, 'La desactivación del cliente también se respeta sin detener la organización');
    await db.collection('clients').doc(root.id).update({ 'automation.enabled': true });
    await automateNewPhotos(drive, root, doc, config, run, 'lease', Date.now() + 60_000);
    let jobs = await db.collection('automationJobs').get();
    assert.equal(jobs.size, 1);
    const job = jobs.docs[0].data();
    assert.equal(job.inputImages.length, 2);
    assert.equal(job.inputImages[0].fileName, 'front-high.jpg');
    assert.equal(job.effectivePolicy.allowEstimatedCosts, true);
    assert.equal((await doc.get()).data().counts.automationNeedsReview, 1);
    assert.match((await root.collection('photos').doc('uncertain').get()).data().issue, /Generación pendiente/);
    assert.equal((await root.collection('generationSources').get()).size, 3);
    assert.equal(copiesVerified, 4);
    await worker.processAutomation(job.id);
    const prepared = (await jobs.docs[0].ref.get()).data();
    assert.equal(prepared.status, 'processing', JSON.stringify(prepared.error));
    assert.equal(prepared.generationJobIds.length, 6);
    const batch = (await db.collection('batches').doc(prepared.batchId).get()).data();
    assert.equal(batch.aspectRatio, '3:4');
    assert.equal(batch.provider, 'fal-gpt-image-2.5-flare');
    await doc.update({ phase: 'automation' });
    await automateNewPhotos(drive, root, doc, config, run, 'lease', Date.now() + 60_000);
    assert.equal((await db.collection('automationJobs').get()).size, 1);

    const nextDoc = root.collection('runs').doc('second');
    const next = makeRun(nextDoc.id);
    await nextDoc.set(next);
    const fresh = source('fresh');
    await insert(fresh);
    await nextDoc.collection('files').doc('fresh').set({ entry: fresh.entry, added: true });
    // Simulate the process dying after job creation but before recording consumption.
    const actualCreate = persistence.createAutomation;
    const interrupted = mock.method(persistence, 'createAutomation', async (...args: unknown[]) => {
      await actualCreate(...args); throw new Error('simulated interruption');
    });
    await assert.rejects(() => automateNewPhotos(drive, root, nextDoc, config, next, 'lease', Date.now() + 60_000), /simulated interruption/);
    interrupted.mock.restore();
    await automateNewPhotos(drive, root, nextDoc, config, next, 'lease', Date.now() + 60_000);
    jobs = await db.collection('automationJobs').get();
    assert.equal(jobs.size, 2);
    assert.equal((await nextDoc.collection('generationHandoffs').get()).size, 1);
    assert.equal((await root.collection('generationSources').get()).size, 4);
    // Drive can increment its version on renames/moves without changing pixels.
    fresh.entry.version = '2'; fresh.entry.name = 'renamed.jpg';
    await nextDoc.collection('files').doc('fresh').set({ entry: fresh.entry, changed: true });
    await nextDoc.update({ phase: 'automation' });
    await automateNewPhotos(drive, root, nextDoc, config, next, 'lease', Date.now() + 60_000);
    assert.equal((await db.collection('automationJobs').get()).size, 2, 'Un cambio de metadatos no vuelve a generar');
    fresh.entry.md5Checksum = 'changed-pixels';
    await insert(fresh);
    await nextDoc.collection('files').doc('fresh').set({ entry: fresh.entry, changed: true });
    await automateNewPhotos(drive, root, nextDoc, config, next, 'lease', Date.now() + 60_000);
    assert.equal((await db.collection('automationJobs').get()).size, 3, 'Un cambio real de contenido se procesa');
    assert.equal((await root.collection('generationSources').get()).size, 5);
    await db.collection('users').doc(uid).update({ active: false });
    const revoked = source('revoked');
    await insert(revoked);
    await nextDoc.collection('files').doc('revoked').set({ entry: revoked.entry, added: true });
    await assert.rejects(() => automateNewPhotos(drive, root, nextDoc, config, next, 'lease', Date.now() + 60_000), { code: 'permission-denied' });
    assert.equal((await db.collection('automationJobs').get()).size, 3, 'Los permisos se comprueban de nuevo');
    assert.ok(originals.every(id => id.startsWith('copy-')));
  } finally { await app.delete(); }
});
