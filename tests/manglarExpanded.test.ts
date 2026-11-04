import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST);
test('Full Manglar delegated MCP, with Firebase emulators and mocked providers', { skip: !enabled }, async (t) => {
    for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'])
        assert.match(process.env[key]!, /^(127\.0\.0\.1|localhost):/);
    const projectId = `demo-manglar-${Date.now()}`;
    process.env.GCLOUD_PROJECT = projectId;
    process.env.GEMINI_API_KEY = 'emulator-only';
    process.env.FAL_KEY = 'emulator-only';
    process.env.BATCH_MAX_JOBS = '100';
    process.env.JOB_MAX_RETRIES = '3';
    process.env.JOB_TIMEOUT_MS = '480000';
    process.env.JOB_AUTO_REVIEW_MAX_ATTEMPTS = '3';
    process.env.JOB_RETRY_DELAY_MS = '300000';
    process.env.GEMINI_IMAGE_REVIEW_MODEL = 'gemini-mock';
    const admin = require('../functions/node_modules/firebase-admin');
    admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
    const db = admin.firestore();
    const { Timestamp } = admin.firestore;
    const oauth = require('../functions/lib/functions/src/automation/mcpOAuth.js');
    const helper = require('../functions/lib/functions/src/automation/mcpOAuth.helpers.js');
    const mcp = require('../functions/lib/functions/src/automation/mcp.js');
    const { MANGLAR_OPERATIONS } = require('../functions/lib/functions/src/manglar/operations.js');
    const { operationSchema } = require('../functions/lib/functions/src/manglar/registry.js');
    const { validateSchema } = require('../functions/lib/functions/src/manglar/schema.js');
    const execution = require('../functions/lib/functions/src/manglar/execution.js');
    const { withManglarContext } = require('../functions/lib/functions/src/manglar/context.js');
    const { runManglarPaid } = require('../functions/lib/functions/src/manglar/budget.js');
    const modelService = require('../functions/lib/functions/src/manglar/catalogService.js');
    const provider = require('../functions/lib/functions/src/providers/fal.js');
    const originalProvider = provider.generateWithNewFalModel;
    const filePrototype = Object.getPrototypeOf(admin.storage().bucket().file('fixture'));
    const originalSignedUrl = filePrototype.getSignedUrl;
    filePrototype.getSignedUrl = async function () { return [`http://127.0.0.1:9199/v0/b/${admin.storage().bucket().name}/o/${encodeURIComponent(this.name)}?alt=media`]; };
    const { processJob } = require('../functions/lib/functions/src/workers/jobWorker.js');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
    const nativeFetch = globalThis.fetch;
    const clientId = 'https://chatgpt.com/oauth/client.json';
    const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
    const verifier = 'expanded-verifier-'.repeat(4);
    let paidRequests = 0;
    globalThis.fetch = (async (url: any, options: any) => {
        if (String(url) === clientId)
            return Response.json({ client_id: clientId, redirect_uris: [redirectUri], token_endpoint_auth_methods_supported: ['none'] });
        if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
            paidRequests++;
            const body = JSON.parse(options.body);
            const text = body.contents?.[0]?.parts?.find((part: any) => part.text)?.text || '';
            const result = text.includes('identif') && text.includes('itemKind') ? {} : text.includes('itemKind') || text.includes('item_kind') ? {} : null;
            // Classifier and image-review JSON; harmless extra fields are ignored by their normalizers.
            return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: 'approved', summary: 'approved mock', criteria: ['identity', 'colors', 'logos', 'parts', 'geometry', 'artifacts', 'scene'].map(key => ({ key, passed: true, notes: 'mock' })), revisedPrompt: '', marketplaceData: {}, itemKind: 'product', itemKindConfidence: 0.99, itemKindReasoning: 'mock object', itemLabel: 'Producto', garmentBodyArea: null, garmentAccessoryType: null, photos: [{ photoId: 'photo1', view: 'front', confidence: 0.99, reasoning: 'mock' }], orientationDetail: 'front', framing: 'full_body', faceVisible: true, confidence: 0.99, ...result }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } });
        }
        // No real provider or other network endpoint is allowed by the fixture.
        const parsed = new URL(String(url));
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname))
            throw new Error(`Unexpected external request: ${parsed.hostname}`);
        return nativeFetch(url, options);
    }) as typeof fetch;
    const connect = async (uid: string) => {
        const query = { client_id: clientId, redirect_uri: redirectUri, state: 'test-state', resource: helper.MANGLAR_MCP_RESOURCE, response_type: 'code', code_challenge: helper.pkceChallenge(verifier), code_challenge_method: 'S256', scope: 'jobs:read jobs:create' };
        const requestId = new URL(await oauth.beginManglarAuthorization(query)).searchParams.get('request');
        const code = new URL((await oauth.decideManglarAuthorization({ requestId, approve: true }, uid)).redirectUrl).searchParams.get('code');
        const tokens = await oauth.exchangeManglarToken({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, resource: helper.MANGLAR_MCP_RESOURCE, code, code_verifier: verifier });
        return { tokens, caller: await oauth.verifyManglarMcpToken(`Bearer ${tokens.access_token}`) };
    };
    const call = (caller: any, domain: string, action: string, data: any = {}, extra: any = {}) => mcp.executeManglarTool(`manglar_${domain}`, { action, data, ...extra }, caller);
    let serial = 0;
    const prepare = async (caller: any, domain: string, action: string, data: any, budgetUsd?: number) => {
        const result = await mcp.executeManglarTool('manglar_prepare_action', { domain, action, data, idempotencyKey: `expanded-${++serial}`, ...(budgetUsd ? { budgetUsd, allowEstimatedCosts: true } : {}) }, caller);
        return { operationId: result.operationId, confirmationToken: result.confirmationToken, ...(budgetUsd ? { confirmedBudgetUsd: budgetUsd } : {}) };
    };
    const write = (caller: any, domain: string, action: string, data: any) => call(caller, domain, action, data, { idempotencyKey: `write-${++serial}` });
    try {
        for (const [uid, role] of [['expanded-admin', 'admin'], ['expanded-operator', 'operador'], ['expanded-other', 'operador'], ['expanded-reviewer', 'revisor']])
            await db.collection('users').doc(uid).set({ uid, email: `${uid}@example.test`, displayName: uid, role, active: true, status: 'active', createdAt: Timestamp.now() });
        for (const id of ['expanded-client', 'expanded-foreign'])
            await db.collection('clients').doc(id).set({ name: id, status: 'active', createdByUid: 'expanded-admin', createdAt: Timestamp.now() });
        for (const uid of ['expanded-operator', 'expanded-other', 'expanded-reviewer'])
            await db.collection('manglarAccess').doc(uid).set({ enabled: true, clientIds: ['expanded-client'], version: 1 });
        const a = await connect('expanded-admin');
        const o = await connect('expanded-operator');
        const other = await connect('expanded-other');
        const r = await connect('expanded-reviewer');
        await t.test('discovery has complete explicit contracts and keeps every historical tool', async () => {
            assert.equal(a.caller.uid, 'expanded-admin');
            assert.equal(o.caller.uid, 'expanded-operator');
            assert.equal(r.caller.role, 'revisor');
            assert.ok(mcp.MANGLAR_MCP_TOOLS.length >= 20);
            assert.ok(MANGLAR_OPERATIONS.length >= 80);
            assert.equal(new Set(MANGLAR_OPERATIONS.map((op: any) => `${op.domain}.${op.action}`)).size, MANGLAR_OPERATIONS.length);
            for (const op of MANGLAR_OPERATIONS) {
                const schema = operationSchema(op);
                assert.equal(schema.type, 'object');
                assert.equal(schema.additionalProperties, false);
            }
            const description = await mcp.executeManglarTool('manglar_describe', { domain: 'users', action: 'update' }, a.caller);
            assert.equal(description.operations[0].inputSchema.properties.role.type, 'string');
            assert.throws(() => validateSchema({ jobId: 'x', extra: 'bad' }, operationSchema(MANGLAR_OPERATIONS.find((op: any) => op.domain === 'catalog' && op.action === 'review'))), { code: 'invalid-argument' });
            assert.throws(() => validateSchema({ jobs: [{ jobId: 'x', provider: 'invented' }] }, operationSchema(MANGLAR_OPERATIONS.find((op: any) => op.action === 'regenerateBulk'))), { code: 'invalid-argument' });
        });
        await t.test('roles, clients, private paths and production ownership cannot be bypassed', async () => {
            await assert.rejects(() => call(o.caller, 'users', 'list'), { code: 'permission-denied' });
            await assert.rejects(() => call(o.caller, 'clients', 'get', { id: 'expanded-foreign' }), { code: 'permission-denied' });
            await assert.rejects(() => call(r.caller, 'wizard', 'defaults'), { code: 'permission-denied' });
            await assert.rejects(() => call(o.caller, 'files', 'preview', { storagePath: 'garments/drafts/expanded-other/draft/item/photo.jpg' }), { code: 'permission-denied' });
            await assert.rejects(() => call(a.caller, 'files', 'preview', { storagePath: 'garments/drafts/expanded-admin/../private' }), { code: 'invalid-argument' });
            await db.collection('jobs').doc('expanded-owned').set({ clientId: 'expanded-client', createdByUid: o.caller.uid, batchId: 'expanded-batch', status: 'failed', provider: 'fal-gpt-image-2.5-flare', promptBase: 'prompt', createdAt: Timestamp.now() });
            await db.collection('batches').doc('expanded-batch').set({ clientId: 'expanded-client', createdByUid: o.caller.uid, status: 'failed', createdAt: Timestamp.now() });
            await assert.rejects(() => call(other.caller, 'catalog', 'get', { id: 'expanded-owned' }), { code: 'permission-denied' });
            const review = await call(r.caller, 'catalog', 'get', { id: 'expanded-owned' });
            assert.equal(review.id, 'expanded-owned');
            await assert.rejects(() => write(o.caller, 'catalog', 'flag', { jobId: 'expanded-owned', flagged: true, createdByUid: 'other' }), { code: 'invalid-argument' });
            const flag = await write(r.caller, 'catalog', 'flag', { jobId: 'expanded-owned', flagged: true });
            assert.equal(flag.flagged, true);
            assert.equal((await db.collection('jobs').doc('expanded-owned').get()).data().manuallyFlaggedByUid, r.caller.uid);
        });
        await t.test('client creation and edits reuse business services and exact-key idempotency', async () => {
            const input = { name: 'Cliente creado por MCP', generationPromptBase: 'Prompt autorizado' };
            const first = await call(a.caller, 'clients', 'save', input, { idempotencyKey: 'client-create-once' });
            const again = await call(a.caller, 'clients', 'save', input, { idempotencyKey: 'client-create-once' });
            assert.equal(first.id, again.id);
            await assert.rejects(() => call(a.caller, 'clients', 'save', { ...input, name: 'otro' }, { idempotencyKey: 'client-create-once' }), { code: 'permission-denied' });
            await write(a.caller, 'clients', 'save', { id: first.id, name: 'Cliente editado' });
            assert.equal((await call(a.caller, 'clients', 'get', { id: first.id })).name, 'Cliente editado');
            await write(a.caller, 'clients', 'archive', { id: first.id });
            await write(a.caller, 'clients', 'restore', { id: first.id });
        });
        await t.test('sensitive confirmations bind changes, resources, connection and current versions', async () => {
            const data = { id: 'expanded-foreign' };
            await assert.rejects(() => call(a.caller, 'clients', 'delete', data), { code: 'failed-precondition' });
            const authorization = await prepare(a.caller, 'clients', 'delete', data);
            await assert.rejects(() => call(a.caller, 'clients', 'delete', { id: 'expanded-client' }, { authorization }), { code: 'permission-denied' });
            await assert.rejects(() => call(o.caller, 'clients', 'delete', data, { authorization }), { code: 'permission-denied' });
            await db.collection('clients').doc(data.id).update({ name: 'changed since preview' });
            await assert.rejects(() => call(a.caller, 'clients', 'delete', data, { authorization }), { code: 'failed-precondition' });
            assert.ok((await db.collection('clients').doc(data.id).get()).exists);
            const settings = { jobMaxRetries: 2 };
            const auth = await prepare(a.caller, 'system', 'update', settings);
            await call(a.caller, 'system', 'update', settings, { authorization: auth });
            assert.equal((await call(a.caller, 'system', 'get')).config.jobMaxRetries, 2);
            assert.equal((await execution.readOperation(auth.operationId, a.caller)).state, 'completed');
        });
        await t.test('budget authorization, transactional reservations, uncertainty and concurrency', async () => {
            const data = { jobId: 'expanded-owned' };
            await assert.rejects(() => mcp.executeManglarTool('manglar_prepare_action', { domain: 'catalog', action: 'review', data, idempotencyKey: 'missing-budget' }, r.caller), { code: 'failed-precondition' });
            const authorization = await prepare(r.caller, 'catalog', 'review', data, 0.05);
            await assert.rejects(() => call(r.caller, 'catalog', 'review', data, { authorization: { ...authorization, confirmedBudgetUsd: 100 } }), { code: 'failed-precondition' });
            await db.collection('manglarOperations').doc(authorization.operationId).update({ state: 'running' });
            let executed = 0;
            const results = await Promise.allSettled([1, 2].map(() => withManglarContext({ budgetId: authorization.operationId }, () => runManglarPaid(0.05, async () => { executed++; return 'mock'; }))));
            assert.equal(executed, 1);
            assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
            assert.equal((await execution.readOperation(authorization.operationId, r.caller)).committedUsd, 0.05);
        });
        await t.test('catalog pagination and projections, structured outputs and analytics respect scopes', async () => {
            const page = await call(o.caller, 'catalog', 'list', { clientId: 'expanded-client', limit: 1, fields: ['id', 'status'] });
            assert.equal(page.records.length, 1);
            assert.deepEqual(Object.keys(page.records[0]).sort(), ['id', 'status']);
            await assert.rejects(() => call(o.caller, 'analytics', 'query', { dataset: 'summary' }), { code: 'permission-denied' });
            await assert.rejects(() => call(r.caller, 'analytics', 'query', { dataset: 'summary' }), { code: 'permission-denied' });
            await db.collection('analytics_clients').doc('expanded-client').set({ clientId: 'expanded-client', totalCostUsd: 1.5 });
            assert.equal((await call(r.caller, 'analytics', 'query', { dataset: 'clients', clientId: 'expanded-client' })).records[0].totalCostUsd, 1.5);
        });
        await t.test('date-only ranges include the full final UTC day and preserve pagination',async()=>{
            await db.collection('jobs').doc('dated-job').set({clientId:'expanded-client',createdByUid:o.caller.uid,status:'completed',createdAt:Timestamp.fromDate(new Date('2026-11-03T18:30:00.000Z'))});
            const included=await call(o.caller,'catalog','list',{clientId:'expanded-client',from:'2026-11-03',to:'2026-11-03',limit:100});
            assert.ok(included.records.some((row:any)=>row.id==='dated-job'));
            const excluded=await call(o.caller,'catalog','list',{clientId:'expanded-client',to:'2026-11-02',limit:100});
            assert.equal(excluded.records.some((row:any)=>row.id==='dated-job'),false);
        });
        await t.test('spreadsheet categories are fully pageable and timeless aggregates reject misleading date filters',async()=>{
            const collection=db.collection('clients').doc('expanded-client').collection('spreadsheetTemplates').doc('paged-template').collection('categories');
            for(const id of ['category-a','category-b','category-c'])await collection.doc(id).set({label:id});
            const first=await call(o.caller,'spreadsheets','categories',{clientId:'expanded-client',templateId:'paged-template',limit:2});
            assert.equal(first.categories.length,2);assert.ok(first.nextCursor);
            const second=await call(o.caller,'spreadsheets','categories',{clientId:'expanded-client',templateId:'paged-template',limit:2,cursor:first.nextCursor});
            assert.equal(second.categories.length,1);assert.equal(second.nextCursor,null);
            await assert.rejects(()=>call(a.caller,'analytics','query',{dataset:'summary',from:'2026-11-01'}),{code:'failed-precondition'});
        });
        await t.test('finance and user administration use the same authorized handlers', async () => {
            const data = { email: 'new-operator@example.test', displayName: 'MCP Operator', password: 'emulator-password-only', role: 'operador', active: true };
            const authorization = await prepare(a.caller, 'users', 'create', data);
            assert.equal(JSON.stringify((await db.collection('manglarOperations').doc(authorization.operationId).get()).data()).includes(data.password), false);
            const created = await call(a.caller, 'users', 'create', data, { authorization });
            assert.equal(created.user.role, 'operador');
            const access = { uid: created.user.uid, enabled: true, clientIds: ['expanded-client'] };
            const consent = await prepare(a.caller, 'connections', 'setAccess', access);
            await call(a.caller, 'connections', 'setAccess', access, { authorization: consent });
            assert.equal((await call(a.caller, 'connections', 'access', { id: access.uid })).enabled, true);
            const event = { type: 'expense', category: 'manual_adjustment', amount: 10, currency: 'USD', description: 'Emulator only', clientId: 'expanded-client' };
            // Use the real financial contract enums; invalid categories must never silently fall back.
            const schema = operationSchema(MANGLAR_OPERATIONS.find((op: any) => op.domain === 'finance' && op.action === 'event'));
            event.type = 'cost';
            event.category = 'manual_adjustment';
            validateSchema(event, schema);
            const approval = await prepare(a.caller, 'finance', 'event', event);
            await call(a.caller, 'finance', 'event', event, { authorization: approval });
            assert.ok((await call(a.caller, 'finance', 'query', { dataset: 'events', clientId: 'expanded-client', detail: true })).records.length > 0);
        });
        await t.test('wizard draft preserves references, requires type choice and generates through the actual queue', async () => {
            const path = `garments/drafts/${o.caller.uid}/expanded-draft/item/photo.jpg`;
            await admin.storage().bucket().file(path).save(png, { metadata: { contentType: 'image/png' } });
            const draft = await write(o.caller, 'wizard', 'saveDraft', { clientId: 'expanded-client', items: [{ id: 'item', name: 'Producto', photos: [{ id: 'photo1', fileName: 'photo.jpg', storagePath: path, sourceIndex: 0 }] }] });
            const classification = await prepare(o.caller, 'wizard', 'classify', { id: draft.id }, 0.1);
            const analysis = await call(o.caller, 'wizard', 'classify', { id: draft.id }, { authorization: classification });
            assert.equal(analysis.garments.length, 1);
            await write(o.caller, 'wizard', 'correct', { id: draft.id, generationKind: 'product' });
            const defaults = await call(o.caller, 'wizard', 'defaults');
            assert.equal(defaults.provider, 'fal-gpt-image-2.5-flare');
            assert.equal(defaults.aspectRatio, '3:4');
            assert.equal(defaults.productScenes.length, 6);
            const request = { requestId: 'expanded-product', clientId: 'expanded-client', items: [{ id: 'item', name: 'Producto', referencePaths: [path] }], scenes: [defaults.productScenes[0]], prompt: defaults.productPrompt, provider: defaults.provider, aspectRatio: '3:4', imageConfig: defaults.imageConfig };
            await assert.rejects(()=>call(o.caller,'wizard','previewProduct',{...request,imageConfig:{provider:'fal-seedream',imageSize:'portrait_4_3'}}),{code:'invalid-argument'});
            const preview = await call(o.caller, 'wizard', 'previewProduct', request);
            assert.equal(preview.actualJobs, 1);
            const data = { draftId: draft.id, request };
            const authorization = await prepare(o.caller, 'wizard', 'createProduct', data, 3);
            const batch = await call(o.caller, 'wizard', 'createProduct', data, { authorization });
            const duplicate = await call(o.caller, 'wizard', 'createProduct', data, { authorization });
            assert.equal(batch.batchId, duplicate.batchId);
            const jobs = await db.collection('jobs').where('batchId', '==', batch.batchId).get();
            assert.equal(jobs.size, 1);
            const job = jobs.docs[0];
            assert.equal(job.data().manglarBudgetId, authorization.operationId);
            provider.generateWithNewFalModel = async () => ({ provider: defaults.provider, imageBytes: png, contentType: 'image/png', remoteUrl: null, requestId: 'mock-provider-request', responseSummary: { mock: true } });
            await processJob(job.id, 'create', { skipBacklogSweep: true });
            const after = (await job.ref.get()).data();
            assert.equal(after.status, 'completed', JSON.stringify({ lastError: after.lastError, failureInfo: after.failureInfo }));
            assert.ok(after.currentOutput?.id, 'actual worker must persist an output');
            const outputs = await call(o.caller, 'catalog', 'outputs', { jobId: job.id, detail: true });
            assert.equal(outputs.records.length, 1);
            assert.equal(outputs.records[0].requestId, 'mock-provider-request');
            const regen = { jobId: job.id, provider: defaults.provider, prompt: 'Updated product prompt' };
            const consent = await prepare(r.caller, 'catalog', 'regenerate', regen, 2);
            await call(r.caller, 'catalog', 'regenerate', regen, { authorization: consent });
            assert.equal((await job.ref.get()).data().manglarBudgetId, consent.operationId);
            assert.equal((await job.ref.get()).data().traceability.lastManualRegeneratedByUid, r.caller.uid);
        });
        await t.test('model editing, classification, visual previews, bundles and output downloads run against Storage emulator', async () => {
            const path = `garments/drafts/${a.caller.uid}/model-draft/pose/photo.png`;
            await admin.storage().bucket().file(path).save(png, { metadata: { contentType: 'image/png' } });
            const data = { clientId: 'expanded-client', name: 'Modelo emulado', posesToAdd: [{ storagePath: path, fileName: 'frente.png' }] };
            const authorization = await prepare(a.caller, 'models', 'save', data, 1);
            const saved = await call(a.caller, 'models', 'save', data, { authorization });
            const model = await call(a.caller, 'models', 'get', { id: saved.id });
            assert.equal(model.poseCount, 1);
            assert.ok(model.poses[0].previewUrl);
            const classify = { modelId: saved.id };
            const approval = await prepare(a.caller, 'models', 'classify', classify, 0.1);
            await call(a.caller, 'models', 'classify', classify, { authorization: approval });
            assert.equal((await call(a.caller, 'models', 'get', { id: saved.id })).poses[0].aiClassification.taggedBy, 'gemini');
            const preview = await call(a.caller, 'files', 'thumbnail', { storagePath: path });
            assert.equal(preview.mimeType, 'image/jpeg');
            assert.ok(preview.__mcpImage.length > 0);
            const bundle = await call(a.caller, 'models', 'export', { id: saved.id });
            assert.ok(bundle.downloadUrl);
            assert.match(bundle.filename, /\.zip$/);
            const temp = (await admin.storage().bucket().getFiles({ prefix: `temp/model_exports/${saved.id}-` }))[0][0];
            assert.ok(temp);
            const importedPath = `model_imports/${a.caller.uid}/bundle/model.zip`;
            await temp.copy(admin.storage().bucket().file(importedPath));
            const importedData = { clientId: 'expanded-client', storagePath: importedPath, originalFileName: 'model.zip' };
            const importApproval = await prepare(a.caller, 'models', 'import', importedData, 1);
            const imported = await call(a.caller, 'models', 'import', importedData, { authorization: importApproval });
            assert.equal(imported.importedPoseCount, 1);
            const generated = await db.collection('jobs').where('createdByUid', '==', o.caller.uid).get();
            const job = generated.docs.find((doc: any) => doc.data().currentOutput);
            assert.ok(job);
            const image = await call(o.caller, 'files', 'image', { jobId: job.id });
            assert.ok(image.url);
            assert.equal(image.outputId, job.data().currentOutput.id);
            const archive = await call(o.caller, 'files', 'zip', { batchId: job.data().batchId, jobIds: [job.id] });
            assert.ok(archive.url);
            assert.match(archive.fileName, /\.zip$/);
            await assert.rejects(() => call(other.caller, 'files', 'image', { jobId: job.id }), { code: 'permission-denied' });
        });
        await t.test('simultaneous retries do not create duplicate entities and old grants stay restricted', async () => {
            const data = { name: 'Concurrent client' };
            const results = await Promise.allSettled([1, 2].map(() => call(a.caller, 'clients', 'save', data, { idempotencyKey: 'concurrent-create' })));
            assert.ok(results.some(result => result.status === 'fulfilled'));
            assert.equal((await db.collection('clients').where('name', '==', data.name).get()).size, 1);
            await db.collection('automationPrincipals').doc('chatgpt-work').set({ active: true, version: 1, allowedClientIds: ['expanded-client'], allowedJobTypes: ['garment', 'product'], scopes: ['jobs:read', 'jobs:create'], secretHashes: [] });
            const grant = 'legacy-grant-test';
            const token = 'manglar_mcp_' + 'l'.repeat(43);
            await db.collection('automationOAuth').doc(`grant-${helper.oauthHash(grant)}`).set({ id: grant, kind: 'grant', ownerUid: a.caller.uid, clientId, resource: helper.MANGLAR_MCP_RESOURCE, scopes: ['jobs:read', 'jobs:create'], principalVersion: 1, active: true, expiresAt: Timestamp.fromMillis(Date.now() + 60000) });
            await db.collection('automationOAuth').doc(`access-${helper.oauthHash(token)}`).set({ kind: 'access', grantId: grant, expiresAt: Timestamp.fromMillis(Date.now() + 60000) });
            const legacy = await oauth.verifyManglarMcpToken(`Bearer ${token}`);
            assert.equal(legacy.role, 'automation');
            assert.equal(legacy.uid, 'automation-chatgpt-work');
            await assert.rejects(() => call(legacy, 'users', 'list'), { code: 'not-found' });
            assert.ok((await mcp.executeManglarTool('manglar_capabilities', {}, legacy)).clients.every((client: any) => client.clientId === 'expanded-client'));
        });
        await t.test('bulk regeneration supports the full fifty-job contract with long approved prompts',async()=>{
            const sample=(await db.collection('jobs').doc('expanded-owned').get()).data();
            const jobs=[];
            for(let i=0;i<50;i++){
                const jobId=`long-bulk-${i}`;
                await db.collection('jobs').doc(jobId).set({...sample,status:'failed'});
                jobs.push({jobId,provider:'fal-gpt-image-2.5-flare',prompt:'Approved photograph instructions. '.repeat(250)});
            }
            const data={jobs};assert.ok(Buffer.byteLength(JSON.stringify(data))>262144);
            const authorization=await prepare(o.caller,'catalog','regenerateBulk',data,50);
            const result=await call(o.caller,'catalog','regenerateBulk',data,{authorization});
            assert.equal(result.queuedJobs,50);
            const audit=(await db.collection('manglarOperations').doc(authorization.operationId).get()).data();
            assert.equal(audit.changes.summarized,true);
            assert.equal(audit.changes.data.jobs.length,50);
            assert.equal(audit.state,'completed');
        });
        await t.test('business handlers recheck scope under delegated context and paid code is simulated only', async () => {
            await assert.rejects(() => withManglarContext({ caller: o.caller, authorize: async () => { throw Object.assign(new Error('scope denied'), { code: 'permission-denied' }); } }, () => modelService.saveClient.run({ auth: { uid: o.caller.uid, token: { role: 'admin' } }, data: { name: 'escalation' } })), { code: 'permission-denied' });
            assert.ok(paidRequests >= 1);
        });
        await t.test('access changes, role changes, deactivation, expiry and per-connection revocation invalidate tokens', async () => {
            const first = await connect('expanded-operator');
            const second = await connect('expanded-operator');
            await oauth.revokeManglarConnection.run({ data: { connectionId: first.caller.connectionId }, auth: { uid: first.caller.uid, token: { role: 'operador' } } });
            await assert.rejects(() => oauth.verifyManglarMcpToken(`Bearer ${first.tokens.access_token}`), { code: 'unauthenticated' });
            assert.equal((await oauth.verifyManglarMcpToken(`Bearer ${second.tokens.access_token}`)).uid, second.caller.uid);
            await db.collection('manglarAccess').doc('expanded-operator').update({ version: 2 });
        const reconnected=await connect('expanded-operator');
        const historic=(await db.collection('manglarOperations').where('ownerUid','==','expanded-operator').limit(1).get()).docs[0];
        assert.ok(historic);
        await assert.rejects(()=>execution.readOperation(historic.id,reconnected.caller),{code:'not-found'});
            await assert.rejects(() => oauth.verifyManglarMcpToken(`Bearer ${second.tokens.access_token}`), { code: 'unauthenticated' });
            await db.collection('users').doc(r.caller.uid).update({ active: false });
            await assert.rejects(() => oauth.verifyManglarMcpToken(`Bearer ${r.tokens.access_token}`), { code: 'unauthenticated' });
            const expiring = await connect('expanded-admin');
            await db.collection('automationOAuth').doc(`access-${helper.oauthHash(expiring.tokens.access_token)}`).update({ expiresAt: Timestamp.fromMillis(0) });
            await assert.rejects(() => oauth.verifyManglarMcpToken(`Bearer ${expiring.tokens.access_token}`), { code: 'unauthenticated' });
        });
    }
    finally {
        globalThis.fetch = nativeFetch;
        provider.generateWithNewFalModel = originalProvider;
        filePrototype.getSignedUrl = originalSignedUrl;
        await db.terminate();
        await admin.app().delete();
    }
});
