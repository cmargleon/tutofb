import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import type { OrganizerSettings } from '../shared/src/types';
import type { DriveFile } from '../functions/src/organizer/drive';
import type { StoredRun } from '../functions/src/organizer/store';

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const local = [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_STORAGE_EMULATOR_HOST]
  .every(value => /^((127\.0\.0\.1)|localhost):\d+$/.test(value || ''));

test('organizador de extremo a extremo con Firestore local, Drive y Gemini simulados', { skip: !local, timeout: 120_000 }, async ({ mock }) => {
  const admin: typeof import('../functions/node_modules/firebase-admin') = requireFunctions('firebase-admin');
  const app = admin.initializeApp({ projectId: 'demo-tutofb-organizer', storageBucket: 'demo-tutofb-organizer.appspot.com' });
  const { OrganizerDrive, FOLDER, SHEET } = requireFunctions('./lib/functions/src/organizer/drive.js') as typeof import('../functions/src/organizer/drive');
  const { defaultConfig, clientRef, enqueue, runRef } = requireFunctions('./lib/functions/src/organizer/store.js') as typeof import('../functions/src/organizer/store');
  const { reserveOrganizerBudget, settleOrganizerBudget, reconcileReservations, holdFor } = requireFunctions('./lib/functions/src/organizer/vision.js') as typeof import('../functions/src/organizer/vision');
  const { tickOrganizer } = requireFunctions('./lib/functions/src/organizer/worker.js') as typeof import('../functions/src/organizer/worker');
  const { executeOrganizer } = requireFunctions('./lib/functions/src/organizer/api.js') as typeof import('../functions/src/organizer/api');
  const sharp: typeof import('../functions/node_modules/sharp') = requireFunctions('sharp');
  const db = admin.firestore();
  const clientId = 'client-fixture';
  const owner = [{ permissionId: 'private-owner' }];
  const folder = (id: string, parents: string[]): DriveFile => ({ id, name: id, mimeType: FOLDER, parents, owners: owner, capabilities: { canAddChildren: true } });
  const files = new Map<string, DriveFile>([
    ['parent', folder('parent', [])], ['origin', folder('origin', ['parent'])], ['sub', folder('sub', ['origin'])],
    ['book', { id: 'book', name: 'Productos', mimeType: SHEET, parents: ['origin'], version: '1' }],
    ['front', { id: 'front', name: 'A218.jpg', mimeType: 'image/jpeg', parents: ['sub'], version: '1', md5Checksum: 'front-hash' }],
    ['back', { id: 'back', name: '2.jpg', mimeType: 'image/jpeg', parents: ['sub'], version: '1', md5Checksum: 'back-hash' }],
  ]);
  const original = new Map([...files].map(([id, file]) => [id, structuredClone(file)]));
  const writes: string[] = [];
  let pages = 0;
  let created = 0;
  let catalogName = 'Suéter';
  let brokenHeader = false;
  const backJpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } }).jpeg().toBuffer();
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).jpeg().toBuffer();
  const transport: typeof globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    const path = url.pathname.split('/');
    const resource = path.at(-1)!;
    if (resource === 'startPageToken') return Response.json({ startPageToken: 'changes-0' });
    if (resource === 'changes') return Response.json({ newStartPageToken: 'changes-1', changes: [] });
    if (url.hostname === 'sheets.googleapis.com') {
      if (path.includes('values')) return Response.json({ values: resource.includes('Portada') ? [['Instrucciones']] :
        [brokenHeader ? ['Campo extraño', 'Título', 'Valor'] : ['SKC', 'Nombre', 'Color'], ['A218', catalogName, 'Rojo']] });
      return Response.json({ sheets: [{ properties: { sheetId: 0, title: 'Portada', sheetType: 'GRID' } }, { properties: { sheetId: 8, title: "Ropa d'otoño", sheetType: 'GRID' } }] });
    }
    if (init?.method === 'POST') {
      writes.push(url.pathname);
      const bodyText = String(init.body);
      const body = bodyText.startsWith('--') ? JSON.parse(bodyText.split('\r\n')[3]) : JSON.parse(bodyText);
      const copy = resource === 'copy' ? files.get(path.at(-2)!) : undefined;
      const id = `managed-${++created}`;
      const item = { ...copy, ...body, id };
      files.set(id, item);
      return Response.json(item);
    }
    if (init?.method === 'PATCH') {
      assert.ok(!original.has(resource), 'Nunca modifica un original');
      writes.push(url.pathname);
      const item = { ...files.get(resource)!, parents: [url.searchParams.get('addParents')!] };
      files.set(resource, item);
      return Response.json(item);
    }
    if (resource === 'files') {
      const query = url.searchParams.get('q') || '';
      const [, parent] = query.match(/^'([^']+)' in parents/) || [];
      const [, key] = query.match(/value='([^']+)'/) || [];
      const all = [...files.values()].filter(file => file.parents?.includes(parent) && (!key || file.appProperties?.organizerKey === key));
      if (key || all.length < 2) return Response.json({ files: all });
      const index = Number(url.searchParams.get('pageToken') || 0);
      pages++;
      return Response.json({ files: all.slice(index, index + 1), ...(index + 1 < all.length ? { nextPageToken: String(index + 1) } : {}) });
    }
    if (url.searchParams.get('alt') === 'media') return new Response(Uint8Array.from(files.get(resource)?.name === '2.jpg' ? backJpeg : jpeg));
    if (files.has(resource)) return Response.json(files.get(resource));
    return Response.json({ error: { errors: [{ reason: 'notFound' }] } }, { status: 404 });
  };
  const drive = new OrganizerDrive(async () => 'fake-oauth', transport);
  const settings: OrganizerSettings = { sourceIds: ['origin'], parentId: 'parent', folderName: 'Salida', enabled: false, debounceMinutes: 2,
    budgetUsd: 40, model: 'gemini-3.1-flash-lite', escalationModel: null, minimumConfidence: 0.75, controlSheet: true,
    allowInheritedAccess: false, operatorUids: ['operator'], directories: { sources: 'Fuentes', pending: 'Pendientes', review: 'Revisar', uploaded: 'Subidos', reports: 'Reportes' } };
  const nativeFetch = globalThis.fetch;
  let geminiCalls = 0; let pixelCalls = 0;
  mock.method(globalThis, 'fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    if (!String(request).startsWith('https://generativelanguage.googleapis.com/')) return nativeFetch(request, init);
    geminiCalls++;
    const body = JSON.parse(String(init?.body));
    const context = JSON.parse(body.contents[0].parts[0].text.split('\n').at(-1));
    if (!context.images) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ resolved: false, folders: [], columns: [], conventions: [], relationships: [], unresolved: ['Revisión de estructura simulada'] }) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30 } });
    pixelCalls++;
    const pixel = await sharp(Buffer.from(body.contents[0].parts[1].inline_data.data, 'base64')).stats();
    const images = context.images.map((item: { id: string }) => ({ id: item.id, view: pixel.channels[2].mean > pixel.channels[0].mean ? 'back' : 'front',
      quality: 0.9, confidence: 0.92, variantId: null }));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ kind: 'garment', label: 'Suéter', photos: images }) }] } }],
      usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 150, thoughtsTokenCount: 25 } });
  });
  const actor = { uid: 'operator', role: 'operador' as const };
  try {
    await db.collection('users').doc(actor.uid).set({ uid: actor.uid, active: true, role: actor.role });
    await db.collection('clients').doc(clientId).set({ name: 'Fixture', status: 'active', automation: { driveFolderIds: ['another-origin'] } });
    await clientRef(clientId).set(defaultConfig(clientId, 'Fixture', settings));
    const adminActor = { uid: 'admin', role: 'admin' as const };
    assert.deepEqual(await executeOrganizer({ action: 'clients' }, adminActor), {
      items: [{ id: clientId, name: 'Fixture', configured: true, driveFolderIds: ['another-origin'] }], next: null,
    });
    await assert.rejects(() => executeOrganizer({ action: 'configure', clientId,
      settings: { ...settings, sourceIds: ['unassigned-origin'] } }, adminActor), { code: 'permission-denied' });
    await assert.rejects(() => executeOrganizer({ action: 'config', clientId }, { uid: 'other', role: 'operador' }), /fuera de los permisos/);
    await assert.rejects(() => executeOrganizer({ action: 'start', clientId, mode: 'classify', requestId: 'unauthorized' }, actor), /Simula y revisa el plan/);
    const preview = (await enqueue(clientId, 'dry_run', 'preview', actor.uid))!;
    await tickOrganizer(drive);
    const dryRun = (await runRef(clientId, preview.id).get()).data() as StoredRun;
    assert.equal(dryRun.status, 'completed');
    assert.equal(dryRun.counts.photos, 2);
    assert.deepEqual(writes, []);
    assert.equal(geminiCalls, 0);
    const run = (await executeOrganizer({ action: 'start', clientId, mode: 'classify', requestId: 'manual', confirmedBudgetUsd: 40, planRunId: preview.id }, actor)) as StoredRun;
    assert.equal((await enqueue(clientId, 'classify', 'manual', actor.uid, { confirmedBudgetUsd: 40, planRunId: preview.id }))?.id, run.id);
    await executeOrganizer({ action: 'pause', clientId, runId: run.id }, actor);
    await tickOrganizer(drive);
    assert.equal((await runRef(clientId, run.id).get()).data()?.status, 'paused');
    await executeOrganizer({ action: 'resume', clientId, runId: run.id }, actor);
    await tickOrganizer(drive);
    const completed = (await runRef(clientId, run.id).get()).data() as StoredRun;
    assert.equal(completed.status, 'completed', completed.error || undefined);
    assert.equal(completed.counts.copied, 3);
    assert.equal(completed.counts.automationJobs, 1, 'La organización inicia la automatización sin esperar aprobación manual de referencias');
    assert.equal(completed.counts.selectedReferences, 1, JSON.stringify({counts:completed.counts,imports:(await runRef(clientId,run.id).collection('imports').get()).docs.map(doc=>doc.data()), photos:(await clientRef(clientId).collection('photos').get()).docs.map(doc => doc.data())}));
    assert.equal(completed.reservedUsd, 0);
    assert.ok(completed.estimatedUsd > 0 && completed.estimatedUsd < 0.01);
    assert.equal(pixelCalls, 2);
    assert.ok(geminiCalls >= 3);
    assert.ok(completed.reportUrl && completed.controlSheetUrl);
    assert.ok(pages >= 4);
    assert.deepEqual([...original].map(([id]) => files.get(id)), [...original.values()]);
    const product = (await clientRef(clientId).collection('products').get()).docs[0];
    await executeOrganizer({ action: 'references', clientId, variantId: product.id, decision: 'approve' }, actor);
    const sync = (await enqueue(clientId, 'sync', 'incremental', actor.uid, { confirmedBudgetUsd: 40 }))!;
    await tickOrganizer(drive);
    const after = (await runRef(clientId, sync.id).get()).data() as StoredRun;
    assert.equal(after.status, 'completed', after.error || undefined);
    assert.equal(after.counts.new, 0);
    assert.equal(after.counts.automationJobs, 0, 'Una sincronización sin fotos nuevas no vuelve a generar');
    assert.equal(after.calls, 0);
    assert.equal((await clientRef(clientId).collection('products').doc(product.id).get()).data()?.referenceState, 'approved');
    assert.equal(writes.filter(path => path.endsWith('/copy')).length, 3);

    const second = clientRef(clientId).collection('products').doc('second-variant');
    await second.set({ ...product.data(), id: second.id, visual: 'BETA', base: 'BETA', name: 'Termo de acero', references: { front: [], back: [], main: [] }, referenceState: 'pending' });
    await assert.rejects(() => executeOrganizer({ action: 'correct', clientId, photoId: 'front', variantId: product.id,
      referenceVariantIds: [second.id] }, actor), /debe pertenecer/);
    await executeOrganizer({ action: 'correct', clientId, photoId: 'front', variantId: null,
      variantIds: [product.id, second.id], referenceVariantIds: [product.id] }, actor);
    const sharedPhoto = (await clientRef(clientId).collection('photos').doc('front').get()).data()!;
    assert.equal(sharedPhoto.variantId, null); assert.deepEqual(sharedPhoto.referenceEligibleFor, [product.id]);
    await product.ref.update({ referenceState: 'suggested', references: { front: ['front'], back: ['back'], main: [] } });
    await second.update({ referenceState: 'suggested', references: { front: [], back: [], main: ['front'] } });
    await executeOrganizer({ action: 'references', clientId, variantId: product.id, decision: 'approve' }, actor);
    await assert.rejects(() => executeOrganizer({ action: 'references', clientId, variantId: second.id, decision: 'approve' }, actor), /ya no pertenece/);
    const imageMock = mock.method(OrganizerDrive.prototype, 'image', async () => jpeg);
    try {
      const draft = await executeOrganizer({ action: 'draft', clientId, variantId: product.id }, actor) as { photos: unknown[] };
      assert.equal(draft.photos.length, 2, 'Una foto compartida puede servir a la variante explícitamente aprobada');
    } finally { imageMock.mock.restore(); }
    await executeOrganizer({ action: 'correct', clientId, photoId: 'front', variantId: product.id }, actor);
    await second.delete();

    const movesBeforeStatus = writes.filter(path => !path.endsWith('/copy') && path.includes('/files/')).length;
    await product.ref.update({ status: 'uploaded' });
    const statusRun = (await enqueue(clientId, 'sync', 'status-filter', actor.uid, { confirmedBudgetUsd: 40 }))!;
    await tickOrganizer(drive);
    assert.equal((await runRef(clientId, statusRun.id).get()).data()?.calls, 0);
    assert.equal(writes.filter(path => !path.endsWith('/copy') && path.includes('/files/')).length, movesBeforeStatus, 'Los estados no mueven productos');

    catalogName = 'Suéter de lana';
    files.set('book', { ...files.get('book')!, version: '2' });
    const excelRun = (await enqueue(clientId, 'sync', 'excel-change', actor.uid, { confirmedBudgetUsd: 40 }))!;
    await tickOrganizer(drive);
    assert.equal((await runRef(clientId, excelRun.id).get()).data()?.status, 'completed');
    assert.equal(pixelCalls, 2, 'Cambiar Excel conserva la caché de píxeles');
    assert.notEqual((await product.ref.get()).data()?.referenceState, 'approved', 'El cambio semántico requiere revisar referencias');
    await executeOrganizer({ action: 'correct', clientId, photoId: 'front', variantId: product.id }, actor);
    const decisionRun = (await enqueue(clientId, 'sync', 'human-kept', actor.uid, { confirmedBudgetUsd: 40 }))!;
    await tickOrganizer(drive);
    assert.equal((await runRef(clientId, decisionRun.id).get()).data()?.status, 'completed');
    assert.equal((await clientRef(clientId).collection('photos').doc('front').get()).data()?.reviewedBy, actor.uid);
    assert.equal(pixelCalls, 2);
    files.set('front', { ...files.get('front')!, version: '2', md5Checksum: 'changed-pixels' });
    const imageRun = (await enqueue(clientId, 'sync', 'image-change', actor.uid, { confirmedBudgetUsd: 40 }))!;
    await tickOrganizer(drive);
    assert.equal((await runRef(clientId, imageRun.id).get()).data()?.status, 'completed');
    assert.equal(pixelCalls, 3, 'Solo una imagen cambió');
    const stale = (await clientRef(clientId).collection('photos').doc('front').get()).data()!;
    assert.equal(stale.method, 'revision_humana_caducada'); assert.equal(stale.variantId, null);

    // A group correction must preserve the human exception on the seed's neighbor.
    await executeOrganizer({ action: 'correct', clientId, photoId: 'back', variantId: null }, actor);
    await executeOrganizer({ action: 'correct', clientId, photoId: 'front', photoIds: ['back'], variantId: product.id }, actor);
    assert.equal((await clientRef(clientId).collection('photos').doc('back').get()).data()?.variantId, null);

    brokenHeader = true; files.set('book', { ...files.get('book')!, version: '3' });
    const unreadableRun = (await enqueue(clientId, 'sync', 'unknown-structure', actor.uid, { confirmedBudgetUsd: 40 }))!;
    await tickOrganizer(drive);
    const unreadable = (await runRef(clientId, unreadableRun.id).get()).data()!;
    assert.equal(unreadable.status, 'failed'); assert.match(unreadable.error, /Se conserva el catálogo anterior/);
    assert.equal((await clientRef(clientId).collection('products').get()).size, 1);
    await executeOrganizer({ action: 'cancel', clientId, runId: unreadableRun.id }, actor);
    brokenHeader = false; files.set('book', { ...files.get('book')!, version: '4' });
    const restored = (await enqueue(clientId, 'sync', 'restored-source', actor.uid, { confirmedBudgetUsd: 40 }))!;
    await tickOrganizer(drive);
    assert.equal((await runRef(clientId, restored.id).get()).data()?.status, 'completed');

    const configRef = clientRef(clientId);
    await configRef.update({ enabled: true, generationActor: admin.firestore.FieldValue.delete() });
    await tickOrganizer(drive);
    assert.equal((await configRef.get()).data()?.changeCursor, 'changes-0');
    assert.equal((await configRef.get()).data()?.watcher, 'idle');
    files.set('extra', { id: 'extra', name: 'notes.pdf', mimeType: 'application/pdf', parents: ['origin'], version: '1' });
    await tickOrganizer(drive);
    assert.equal((await configRef.get()).data()?.activeRunId, null);
    await configRef.update({ lastFullScanAt: 0 });
    await tickOrganizer(drive);
    assert.equal((await configRef.get()).data()?.watcher, 'collecting');
    assert.equal((await configRef.get()).data()?.activeRunId, null);
    await configRef.update({ observedAt: Date.now() - 3 * 60_000 });
    const runs = configRef.collection('runs');
    const priorRunIds = new Set((await runs.get()).docs.map(doc => doc.id));
    await tickOrganizer(drive);
    const newRuns = (await runs.get()).docs.filter(doc => !priorRunIds.has(doc.id));
    assert.equal(newRuns.length, 1);
    const automatic = newRuns[0].data() as StoredRun;
    assert.equal(automatic.status, 'completed', automatic.error || undefined);
    assert.equal(automatic.createdBy, 'watcher');
    assert.equal(automatic.generationUid, actor.uid, 'La vigilancia recupera al responsable de la última ejecución manual en configuraciones anteriores');
    assert.equal(automatic.counts.new, 1);
    assert.equal(pixelCalls, 3, 'Un archivo nuevo no reanaliza píxeles previos');

    const ledgerRun = (await enqueue(clientId, 'classify', 'ledger', actor.uid, { confirmedBudgetUsd: 40 }))!;
    const ledger = runRef(clientId, ledgerRun.id);
    const model = settings.model;
    await ledger.update({ status: 'running', lease: 'test-lease', leaseUntil: Date.now() + 60_000, budgetUsd: holdFor(model) / 1_000_000 });
    const attempts = await Promise.allSettled(['a', 'b'].map(id => reserveOrganizerBudget(ledger, 'test-lease', id, model)));
    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
    const winner = attempts[0].status === 'fulfilled' ? 'a' : 'b';
    await settleOrganizerBudget(ledger, winner, { input: 0, output: 0, thinking: 0 }, null);
    assert.equal((await ledger.get()).data()?.reservedUsd, 0);
    assert.equal(await reserveOrganizerBudget(ledger, 'test-lease', 'orphan', model), true);
    await ledger.collection('ledger').doc('orphan').update({ expiresAt: 0 });
    await reconcileReservations(ledger);
    assert.equal((await ledger.get()).data()?.uncertainUsd, holdFor(model) / 1_000_000);
    assert.equal((await ledger.get()).data()?.reservedUsd, 0);
    await assert.rejects(() => reserveOrganizerBudget(ledger, 'test-lease', 'over-budget', model), /Presupuesto disponible insuficiente/);
    await settleOrganizerBudget(ledger, 'orphan', { input: 600, output: 150, thinking: 25 }, null);
    await ledger.update({ budgetUsd: 0.2 });
    for (let index = 0; index < 45; index++) {
      const key = `settled-${index}`;
      assert.equal(await reserveOrganizerBudget(ledger, 'test-lease', key, model), true);
      await settleOrganizerBudget(ledger, key, { input: 600, output: 150, thinking: 25 }, null);
    }
    const finalLedger = (await ledger.get()).data()!;
    assert.equal(finalLedger.calls, 47);
    assert.equal(finalLedger.reservedUsd, 0);
    assert.equal(finalLedger.uncertainUsd, 0);
    await ledger.update({ maxCalls: finalLedger.calls });
    await assert.rejects(() => reserveOrganizerBudget(ledger, 'test-lease', 'over-call-limit', model), /Límite de llamadas/);
  } finally { await app.delete(); }
});
