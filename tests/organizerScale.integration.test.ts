import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-organizer-scale';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// A whole Drive update (1000 photos → 500 articles) is processed in many short slices without starting over,
// handed to automation in jobs that fit Firestore, and exported/prepared at that scale (local Firebase only).
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const local = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']
  .every(key => /^((127\.0\.0\.1)|localhost):\d+$/.test(process.env[key] || ''));

test('1000 fotos, 500 artículos, >1000 jobs y preparación por tramos sin reinicios (Firebase local)', { skip: !local, timeout: 600_000 }, async t => {
  const admin: typeof import('../functions/node_modules/firebase-admin') = requireFunctions('firebase-admin');
  const app = admin.initializeApp({ projectId: 'demo-manglar-automation', storageBucket: 'demo-manglar-automation.appspot.com' });
  const sharp: typeof import('../functions/node_modules/sharp') = requireFunctions('sharp');
  const db = requireFunctions('./lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const { automateNewPhotos, ORGANIZER_ARTICLES_PER_JOB } = requireFunctions('./lib/functions/src/organizer/automation.js') as typeof import('../functions/src/organizer/automation');
  const { clientRef, runRef, defaultConfig } = requireFunctions('./lib/functions/src/organizer/store.js') as typeof import('../functions/src/organizer/store');
  const { createAutomation } = requireFunctions('./lib/functions/src/automation/persistence.js') as typeof import('../functions/src/automation/persistence');
  const { readPaged, loadExportContext, EXPORT_LIMITS } = requireFunctions('./lib/functions/src/spreadsheets/marketplaceExportService.js') as typeof import('../functions/src/spreadsheets/marketplaceExportService');
  const precompute = requireFunctions('./lib/functions/src/spreadsheets/marketplacePrecompute.js') as typeof import('../functions/src/spreadsheets/marketplacePrecompute');
  const precomputeState = requireFunctions('./lib/functions/src/spreadsheets/marketplacePrecomputeState.js') as typeof import('../functions/src/spreadsheets/marketplacePrecomputeState');
  const clientId = 'scale-client'; const uid = 'scale-operator';
  try {
    await db.collection('users').doc(uid).set({ uid, role: 'operador', active: true, clientAccess: { mode: 'global' } });
    await db.collection('clients').doc(clientId).set({ name: 'Escala', status: 'active', marketplaces: { shein: { enabled: true } },
      automation: { enabled: true, organizerGeneration: { enabled: true }, defaultBudgetUsd: 2, maxBudgetUsd: 400 } });
    await db.collection('system_config').doc('main').set({ organizerAutoGenerationEnabled: true,
      automationBudget: { defaultBudgetUsd: 10, maxBudgetUsd: 100, maxReviewAttempts: 3, maxOperationalRetries: 2 } });

    await t.test('organizador: 1000 fotos en tramos cortos, sin descargar ni preparar dos veces', async () => {
      const settings = { sourceIds: ['origin'], enabled: true, debounceMinutes: 2, budgetUsd: 2, model: 'gemini-3.1-flash-lite', escalationModel: null,
        minimumConfidence: 0.75, controlSheet: false, operatorUids: [uid] };
      await clientRef(clientId).set(defaultConfig(clientId, 'Escala', settings as never));
      const config = (await clientRef(clientId).get()).data() as import('../functions/src/organizer/store').StoredConfig;
      const run = { id: 'scale-run', clientId, mode: 'classify', status: 'running', phase: 'automation', createdAt: Date.now(), updatedAt: Date.now(), completedAt: null,
        createdBy: 'watcher', generationUid: uid, budgetUsd: 2, estimatedUsd: 0, reservedUsd: 0, uncertainUsd: 0, alerts: [], calls: 0, counts: {}, error: null,
        reportUrl: null, controlSheetUrl: null, cursor: null, lease: 'scale-lease', leaseUntil: Date.now() + 3_600_000, fingerprint: 'f', variantId: null,
        photoIds: [], delegated: null } as unknown as import('../functions/src/organizer/store').StoredRun;
      const doc = runRef(clientId, run.id);
      await doc.set(run);
      const root = clientRef(clientId);
      // Opposite gradients: the two views of an article are different images (not near-duplicates).
      const gradient = (reverse: boolean) => sharp(Buffer.from(Array.from({ length: 32 * 32 }, (_, i) => { const x = i % 32; return (reverse ? 31 - x : x) * 8; })),
        { raw: { width: 32, height: 32, channels: 1 } }).jpeg().toBuffer();
      const [jpeg, reversed] = await Promise.all([gradient(false), gradient(true)]);
      const bytesOf = (id: string) => Number(id.slice(1)) % 2 ? reversed : jpeg;
      const files = []; const photos = [];
      for (let index = 0; index < 1000; index++) {
        const article = Math.floor(index / 2);
        const entry = { id: `p${String(index).padStart(4, '0')}`, name: `art-${article}-${index % 2 ? 'b' : 'a'}.jpg`, mimeType: 'image/jpeg', parents: [`folder-${article}`],
          md5Checksum: `md5-${index}`, size: '100', version: '1', sourceId: 'origin', path: ['origin', `folder-${article}`, `${index}.jpg`], ancestorIds: ['origin'] };
        files.push({ id: entry.id, value: { entry, added: true } });
        photos.push({ id: entry.id, value: { id: entry.id, name: entry.name, path: entry.path, sourceUrl: '', copyUrl: null, variantId: null, variantIds: [], candidates: [],
          evidence: [], confidence: 0, method: 'gemini', issue: null, hasConflict: false, identityState: 'unresolved', kind: 'product', view: index % 2 ? 'side' : 'front',
          quality: 0.9, visualConfidence: 0.9, visualHint: { groupId: `article-${article}`, label: `Artículo ${article}`, color: '', pack: '', kind: 'product' } } });
      }
      const { writePages } = requireFunctions('./lib/functions/src/organizer/store.js') as typeof import('../functions/src/organizer/store');
      await writePages(doc.collection('files'), files);
      await writePages(root.collection('photos'), photos);
      let hashDownloads = 0; let sourceDownloads = 0; let assertions = 0;
      const drive = {
        assertSource: async () => { assertions++; },
        image: async (id: string) => { hashDownloads++; return bytesOf(id); },
        sourceImage: async (entry: { id: string }) => { sourceDownloads++; return bytesOf(entry.id); },
      } as unknown as import('../functions/src/organizer/drive').OrganizerDrive;
      let slices = 0;
      while ((await doc.get()).get('phase') === 'automation') {
        assert.ok(++slices < 400, 'La automatización avanza en cada tramo');
        await automateNewPhotos(drive, root, doc, config, (await doc.get()).data() as typeof run, 'scale-lease', Date.now() + 1500);
      }
      assert.ok(slices > 3, `Se procesó en varios tramos (${slices})`);
      assert.equal(hashDownloads, 1000, 'Cada foto se descarga una sola vez para el hash de duplicados');
      assert.equal(sourceDownloads, 1000, 'Cada referencia se congela una sola vez');
      // Two checks per hash and per freeze; a group cut by the deadline may repeat one reference.
      assert.ok(assertions <= 4000 + 2 * slices, `Sin reinicios desde cero: ${assertions} verificaciones`);
      const after = (await doc.get()).data()!;
      assert.equal(after.counts.automationArticles, 500);
      assert.equal(after.counts.automationPhotos, 1000);
      const jobs = await db.collection('automationJobs').where('metadata.organizerRunId', '==', run.id).get();
      const expected = Math.ceil(500 / ORGANIZER_ARTICLES_PER_JOB.product);
      assert.equal(jobs.size, expected, 'Una actualización = trabajos de objetos que caben en un documento');
      assert.equal(after.counts.automationJobs, expected);
      let links = 0;
      for (const job of jobs.docs) {
        assert.equal(job.get('jobType'), 'product');
        assert.equal(job.get('metadata.organizerChunks'), expected);
        assert.ok(Buffer.byteLength(JSON.stringify(job.data())) < 700_000);
        assert.equal(job.get('budget.limitUsd'), Math.min(400, 2 * job.get('metadata.organizerArticleCount')), 'El máximo del cliente (400) reemplaza al global (100)');
        links += (await job.ref.collection('organizerCommerce').get()).size;
      }
      assert.equal(links, 500);
      assert.equal((await root.collection('generationSources').get()).size, 1000);
      const hashed = await root.collection('photos').where('differenceHash.key', '==', 'md5:md5-0:100').get();
      assert.equal(hashed.size, 1, 'El hash queda guardado en la foto con su versión de contenido');
      // A retried slice after completion re-derives the same groups and keys: nothing is created twice.
      await doc.update({ phase: 'automation' });
      await automateNewPhotos(drive, root, doc, config, (await doc.get()).data() as typeof run, 'scale-lease', Date.now() + 60_000);
      assert.equal((await db.collection('automationJobs').where('metadata.organizerRunId', '==', run.id).get()).size, expected);
      assert.equal(hashDownloads, 1000);
    });

    await t.test('createAutomation: 500 artículos con vínculos y alias escritos por partes, idempotente', async () => {
      const links = Array.from({ length: 500 }, (_, index) => ({ itemId: `item-${index}`, photos: [{ id: `ph-${index}`, version: '1' }], organizerVariantId: null,
        source: { rows: [], issue: null }, ...(index % 10 === 0 ? { catalogBinding: { productId: `master-${index}`, baseCode: `B${index}` } } : {}) }));
      const request = { source: 'api', externalId: 'organizer-scale-500', clientId, jobType: 'product', allowEstimatedCosts: true, authorizeClassification: true, budgetUsd: 300,
        inputImages: links.map(link => ({ itemId: link.itemId, fileName: `${link.itemId}.jpg`, storagePath: `garments/drafts/${uid}/organizer-${link.itemId}/source/image.jpg` })) };
      const receipt = await createAutomation(request, uid, 'operador', undefined, links as never);
      assert.equal(receipt.duplicate, false);
      const job = db.collection('automationJobs').doc(receipt.jobId);
      assert.equal((await job.collection('organizerCommerce').get()).size, 500);
      assert.equal((await job.get()).get('status'), 'pending');
      const aliases = await db.collection('clients').doc(clientId).collection('productAliases').where('automationJobId', '==', receipt.jobId).get();
      assert.ok(aliases.size >= 50, `Alias de los 50 artículos vinculados: ${aliases.size}`);
      const again = await createAutomation(request, uid, 'operador', undefined, links as never);
      assert.deepEqual([again.jobId, again.duplicate], [receipt.jobId, true]);
      await assert.rejects(() => createAutomation({ ...request, externalId: 'other', clientId: 'missing-client' }, uid, 'operador', undefined, links as never));
    });

    await t.test('exportación: un lote con más de 1000 jobs se lee por páginas', async () => {
      const batchId = 'scale-batch';
      await db.collection('batches').doc(batchId).set({ clientId, status: 'completed', generationKind: 'product' });
      const writer = db.bulkWriter();
      for (let index = 0; index < 1300; index++) writer.set(db.collection('jobs').doc(`scale-job-${String(index).padStart(4, '0')}`),
        { clientId, batchId, garmentId: `g-${index % 300}`, garmentName: `Objeto ${index % 300}`, status: 'failed', productScene: `scene-${index % 6}` });
      await writer.close();
      const docs = await readPaged(db.collection('jobs').where('batchId', '==', batchId), EXPORT_LIMITS.jobsPerBatch, 'demasiados');
      assert.equal(docs.length, 1300);
      await assert.rejects(() => readPaged(db.collection('jobs').where('batchId', '==', batchId), 1000, 'tope superado'), /tope superado/);
      const context = await loadExportContext({ clientId, batchIds: [batchId] }, uid);
      assert.equal(context.batches.length, 1);
      assert.equal([...context.jobsByProduct.values()].reduce((sum, list) => sum + list.length, 0), 1300, 'Antes fallaba con más de 1000 jobs');
    });

    await t.test('preparación en segundo plano: tramos encadenados, tope y disparo al terminar', async () => {
      const id = await precomputeState.enqueueMarketplacePrecompute(clientId, ['scale-batch'], uid);
      assert.equal(await precomputeState.marketplacePrecomputeRunning({ clientId, batchIds: ['scale-batch'] }), true, 'El panel no lanza su propio análisis');
      const ref = db.collection(precomputeState.PRECOMPUTE_COLLECTION).doc(id);
      let calls = 0;
      const fake = async () => ({ pending: ++calls < 3, counts: { products: 1, published: calls, squares: 0, failures: 0 } });
      for (let index = 0; index < 3; index++) await precompute.runMarketplacePrecompute(id, 'key', fake as never);
      const done = (await ref.get()).data();
      assert.deepEqual([done.status, done.slices, calls], ['completed', 3, 3], 'Continúa donde quedó hasta terminar');
      assert.equal(await precomputeState.marketplacePrecomputeRunning({ clientId, batchIds: ['scale-batch'] }), false);
      await precomputeState.enqueueMarketplacePrecompute(clientId, ['scale-batch'], uid);
      await ref.update({ slices: precompute.MAX_PRECOMPUTE_SLICES });
      await precompute.runMarketplacePrecompute(id, 'key', fake as never);
      assert.equal((await ref.get()).get('status'), 'failed', 'Tope de tramos');
      await ref.update({ status: 'running', leaseUntil: Date.now() - 1 });
      await precompute.requeueExpiredMarketplacePrecomputes();
      assert.equal((await ref.get()).get('status'), 'queued', 'Un tramo abandonado vuelve a la cola');
      await ref.delete();
      assert.equal(await precompute.onAutomationFinished({ status: 'processing' }, { status: 'completed', clientId, batchId: 'scale-batch', createdByUid: 'automation-x' }), null,
        'Un principal técnico conserva la preparación bajo demanda');
      const queued = await precompute.onAutomationFinished({ status: 'processing' }, { status: 'completed', clientId, batchId: 'scale-batch', createdByUid: uid });
      assert.equal(queued, id);
      assert.equal(await precompute.onAutomationFinished({ status: 'completed' }, { status: 'completed', clientId, batchId: 'scale-batch', createdByUid: uid }), null);
    });
  } finally {
    await cleanupEmulatorDatabase(db);
    await app.delete();
  }
});
