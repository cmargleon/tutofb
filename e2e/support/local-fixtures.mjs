// Browser-only, in-memory Firebase doubles. No SDK or network access.
const now = new Date();
const stamp = { toDate: () => now, toMillis: () => now.getTime() };
export const fixtureImage = '/__tuto_fixture.svg';
export let user = { uid: 'disposable-browser-user', displayName: 'Operador local', getIdToken: async () => 'local-double' };
export const auth = { currentUser: user, app: { options: { projectId: 'demo-local-browser' } } };
export const db = {};
export const storage = {};
export const functions = {};
const client = { id: 'local-client', name: 'Cliente local', status: 'active', active: true };
const batch = { id: 'local-batch', clientId: client.id, clientNameSnapshot: client.name, status: 'completed',
  totalJobs: 1, completedJobs: 1, pendingJobs: 0, processingJobs: 0, failedJobs: 0,
  createdAt: stamp, updatedAt: stamp, poseIds: ['local-pose'], spreadsheetTemplateId: 'local-template' };
const job = { id: 'local-job', batchId: batch.id, clientId: client.id, garmentId: 'local-garment',
  garmentName: 'Artículo local', status: 'completed', provider: 'fal-gpt-image-2', poseId: 'local-pose',
  createdAt: stamp, updatedAt: stamp, outputs: [{ id: 'local-output', approved: true, resultImagePath: 'fixtures/catalog.svg' }],
  currentOutput: { id: 'local-output', resultImagePath: 'fixtures/catalog.svg', status: 'approved' } };
const records = {
  users: [{ id: user.uid, ...user, role: 'admin', active: true }],
  clients: [client], batches: [batch], jobs: [job, { ...job, id: 'local-detail-job', poseId: 'local-detail-pose', currentOutput: { ...job.currentOutput, resultImagePath: 'fixtures/detail.svg' } }], models: JSON.parse(sessionStorage.getItem('tuto-local-models') || '[]'),
  analytics_summary: [{ id: 'global', totalJobs: 1, completedJobs: 1, updatedAt: stamp }],
  system_config: [{ id: 'main' }],
  'clients/local-client/spreadsheetTemplates': [{ id: 'local-template', name: 'Plantilla local' }],
  'clients/local-client/spreadsheetTemplates/local-template/categories': [{ id: 'local-category', sheetName: 'Local',
    columns: [{ key: 'main_img', label: 'Imagen principal', type: 'text' }, { key: 'detail_img_1', label: 'Imagen detalle 1', type: 'text' }] }],
  'batches/local-batch/productDrafts': [{ id: 'local-draft', garmentId: 'local-garment', garmentName: 'Artículo local',
    categoryId: 'local-category', sheetName: 'Local', rows: [{ id: 'local-row', values: { main_img: '', detail_img_1: '' } }] }],
};
const dashboard = window.__dashboardFixture;
if (dashboard) {
  Object.assign(records.users[0], { role: dashboard.role, clientAccess: dashboard.clientAccess });
  const extraClient = { ...client, id: 'other-client', name: 'Otro cliente' };
  const otherBatch = { ...batch, id: 'other-batch', clientId: extraClient.id, clientNameSnapshot: extraClient.name };
  const blockedBatch = { ...batch, id: 'blocked-batch', totalJobs: 1 };
  const oldBatch = { ...batch, id: 'old-batch', createdAt: new Date(0) };
  const scopedJob = (id, fields) => ({ ...job, id, clientNameSnapshot: client.name, ...fields });
  const approved = { ...job.currentOutput, autoReview: { verdict: 'approved' } };
  records.clients.push(extraClient);
  records.batches = [batch, blockedBatch, otherBatch, oldBatch];
  records.jobs = [
    scopedJob('review', { garmentId: 'review-garment', garmentName: 'Foto pendiente de revisión' }),
    scopedJob('approved', { currentOutput: approved }),
    scopedJob('selected', { userSelectedOutput: job.currentOutput }),
    scopedJob('flagged', { currentOutput: approved, manuallyFlagged: true }),
    scopedJob('failed', { status: 'failed' }),
    scopedJob('cancelled', { status: 'failed', failureInfo: { reasonCode: 'manual_cancellation' } }),
    scopedJob('missing', { currentOutput: null }),
    scopedJob('blocked', { batchId: blockedBatch.id, currentOutput: approved }),
    scopedJob('outside', { clientId: extraClient.id, batchId: otherBatch.id, clientNameSnapshot: extraClient.name, status: 'pending' }),
    ...Array.from({ length: 55 }, (_, i) => scopedJob(`old-${i}`, { batchId: oldBatch.id, createdAt: oldBatch.createdAt, status: 'pending' })),
    ...(dashboard.oversized ? Array.from({ length: 1000 }, (_, i) => scopedJob(`extra-${i}`, { batchId: blockedBatch.id, currentOutput: approved })) : []),
  ];
}
const productWorkflow = window.__productWorkflowFixture;
const workflowContext = { clientId: client.id, baseProductId: 'local-base', variantId: 'local-variant' };
const workflowVariant = { id: 'local-variant', name: 'Jarra azul', base: 'JARRA', visual: 'AZUL', color: 'Azul',
  skcs: ['JARRA-AZUL'], skus: [], sizes: [], issues: [], status: 'pending', referenceState: 'approved',
  references: { main: ['reference'], front: [], back: [] } };
const workflowHistory = () => ({ batchId: batch.id, createdAt: 1, itemIds: ['local-garment'],
  masterProductIds: ['local-master'], approved: 1, attention: 1, inProgress: 0, cancelled: 0 });
const restoreWorkflowBatch = () => {
  const saved = sessionStorage.getItem('tuto-workflow-item');
  if (!saved || records.batches.some(item => item.id === 'new-workflow-batch')) return;
  records.batches.push({ ...batch, id: 'new-workflow-batch', spreadsheetTemplateId: null });
  records.jobs.push({ ...job, batchId: 'new-workflow-batch', id: 'workflow-approved', garmentId: saved,
    garmentName: 'Jarra azul', currentOutput: { ...job.currentOutput, resultImagePath: 'generated/local-client/new-workflow-batch/workflow-approved/output.jpg', autoReview: { verdict: 'approved' } } });
  records.jobs.push({ ...job, batchId: 'new-workflow-batch', id: 'workflow-flagged', garmentId: saved, garmentName: 'Jarra azul', manuallyFlagged: true });
  records.jobs.push({ ...job, batchId: 'new-workflow-batch', id: 'workflow-unrelated', garmentId: 'other-item', garmentName: 'Artículo ajeno' });
};
if (productWorkflow) {
  Object.assign(records.users[0], { role: productWorkflow.role, clientAccess: { mode: 'assigned', clientIds: [client.id] } });
  restoreWorkflowBatch();
}
const listeners = new Set();
export const collection = (_, ...parts) => ({ path: parts.join('/'), kind: 'collection', constraints: [] });
export const collectionGroup = collection;
export const doc = (_, ...parts) => ({ path: parts.join('/'), kind: 'doc' });
export const query = (reference, ...constraints) => ({ ...reference, constraints: [...(reference.constraints || []), ...constraints] });
export const where = (field, op, value) => ({ field, op, value });
export const orderBy = (order, direction) => ({ order, direction });
export const limit = max => ({ max });
export const startAfter = () => ({});
// Opt-in catalog editing scenario; other browser journeys keep their fixtures.
if (window.__photoEditFixture) {
  const current = records.jobs[0];
  current.promptBase = 'Prompt original editable';
  current.finalPrompt = 'Prompt original completo';
  current.currentOutput = { ...current.currentOutput, jobId: current.id, batchId: current.batchId,
    clientId: current.clientId, createdAt: stamp, generationAttempt: 2 };
  records[`jobs/${current.id}/outputs`] = [current.currentOutput, { ...current.currentOutput,
    id: 'older-output', resultImagePath: 'fixtures/older.svg', generationAttempt: 1,
    createdAt: { toMillis: () => 1 } }];
}
const snapshotDoc = value => ({ id: value?.id, exists: () => !!value, data: () => value });
function snapshot(reference, fromServer = false) {
  (window.__fixtureReads ||= []).push(reference);
  if (reference.kind === 'doc') {
    const parts = reference.path.split('/'); const id = parts.pop();
    return snapshotDoc((records[parts.join('/')] || []).find(value => value.id === id));
  }
  let rows = records[reference.path] || [];
  for (const { field, op, value } of reference.constraints || []) {
    if (op === '==') rows = rows.filter(row => row[field] === value);
    if (op === 'in') rows = rows.filter(row => value.includes(row[field === '__name__' ? 'id' : field]));
  }
  if (fromServer) {
    const { order, direction } = reference.constraints.find(item => item.order) || {};
    if (order) {
      const millis = row => row[order]?.toMillis?.() ?? +row[order];
      rows = [...rows].sort((a, b) => (millis(a) - millis(b) || a.id.localeCompare(b.id)) * (direction === 'desc' ? -1 : 1));
    }
    const max = reference.constraints.find(item => item.max)?.max;
    if (max) rows = rows.slice(0, max);
  }
  const docs = rows.map(snapshotDoc);
  return { docs, size: docs.length, empty: !docs.length, forEach: callback => docs.forEach(callback), docChanges: () => [] };
}
export const onSnapshot = (reference, callback) => {
  const emit = () => callback(snapshot(reference)); listeners.add(emit); queueMicrotask(emit);
  return () => listeners.delete(emit);
};
export const getDocs = async reference => snapshot(reference);
export const getDocsFromServer = async reference => {
  if (window.__dashboardReadGate) await window.__dashboardReadGate;
  const batchId = reference.constraints.find(item => item.field === 'batchId')?.value;
  if (batchId && batchId === window.__dashboardBatchError) throw new Error('Error de lote simulado');
  return snapshot(reference, true);
};
export const getCountFromServer = async reference => {
  if (window.__dashboardReadGate) await window.__dashboardReadGate;
  const status = reference.constraints.find(item => item.field === 'status')?.value;
  if (status === window.__dashboardCountError) throw new Error('Error de agregado simulado');
  return { data: () => ({ count: snapshot(reference, true).size }) };
};
export const getDoc = getDocs;
export class Timestamp {
  static fromDate(date) { return { toDate: () => date, toMillis: () => date.getTime() }; }
  static now() { return stamp; }
}
export class FirebaseError extends Error {}
export const ref = (_, path) => ({ fullPath: path });
export const documentId = () => '__name__';
export const getBlob = async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' });
export const getDownloadURL = async () => fixtureImage;
const unexpected = () => { throw new Error('BLOCKED: unexpected operation in local fixture'); };
export const uploadBytes = unexpected;
export const uploadBytesResumable = () => {
  if (!productWorkflow) return unexpected();
  return { cancel() {}, on(_event, _progress, _error, done) { queueMicrotask(done); } };
};
export const deleteObject = unexpected;
export const signOut = async () => window.__setFixtureIdentity(null);
export const signInWithEmailAndPassword = unexpected;
export const getIdTokenResult = async () => ({ claims: { role: 'admin' } });
const authListeners = new Set();
window.__setFixtureIdentity = uid => {
  user = uid ? { uid, displayName: uid, getIdToken: async () => 'local-double' } : null;
  auth.currentUser = user;
  if (uid && !records.users.some(record => record.uid === uid)) records.users.push({ id: uid, ...user, role: 'admin', active: true });
  for (const callback of authListeners) callback(user);
};
export const onAuthStateChanged = (_, callback) => { authListeners.add(callback); callback(user); return () => authListeners.delete(callback); };
let marketplaceScenario = 'ready';
window.__setMarketplaceFixture = scenario => { marketplaceScenario = scenario; };
const fixtureChannels = ['shein', 'mercado-libre', 'tiktok-shop', 'amazon'];
let masterFixture = { id: 'local-master', clientId: 'local-client', garmentId: 'local-garment', batchIds: ['local-batch'], values: { name: 'Artículo local', brand: 'Marca local' }, variants: [{ id: 'local-variant', values: { sku: 'LOCAL-001' } }], evidence: {}, legacyDrafts: [], originalImages: [], approvedImages: [{ jobId: 'local-job', outputId: 'local-output', storagePath: 'fixtures/catalog.svg' }], pendingImages: 0, revision: 0, marketplaces: Object.fromEntries(fixtureChannels.map(channel => [channel, { templateId: `export-${channel}`, categoryId: 'products' }])) };
const exportCategories = fixtureChannels.map(channel => ({ id: 'products', templateId: `export-${channel}`, clientId: 'local-client', sheetName: 'Products', label: 'Productos', rowStart: 2, columns: [{ key: 'sku', label: 'SKU', index: 0, letter: 'A', required: true }, { key: 'name', label: 'Nombre de salida', index: 1, letter: 'B', required: true }], attributes: [] }));
const exportTemplates = fixtureChannels.map(channel => ({ id: `export-${channel}`, clientId: 'local-client', name: `Plantilla ${channel}`, status: 'active', createdAt: stamp, updatedAt: stamp, exportConfig: { marketplaceId: channel, version: 1, operation: 'listing', validationStatus: 'compatible', mappings: { products: { sku: { source: 'variant.sku' }, name: { source: 'product.name' } } } } }));
if (window.__marketplaceClientEnabled) {
  client.marketplaces = Object.fromEntries(fixtureChannels.map(id => [id, { enabled: true }]));
  records['clients/local-client/spreadsheetTemplates'] = exportTemplates.map(template => ({ ...template, originalFileName: 'fixture.xlsx', storagePath: 'fixtures/template.xlsx', categories: [{ id: 'products', label: 'Productos' }], categoryIds: ['products'], exportConfig: { ...template.exportConfig, validationMessages: [] } }));
  for (const category of exportCategories) records[`clients/local-client/spreadsheetTemplates/${category.templateId}/categories`] = [category];
  const tiktok = records['clients/local-client/spreadsheetTemplates'].find(t => t.exportConfig.marketplaceId === 'tiktok-shop');
  records['clients/local-client/spreadsheetTemplates'].push({ ...tiktok, id: 'tiktok-shoes', name: 'Calzado TikTok', categories: [{ id: 'shoes', label: 'Calzado' }], status: 'archived' });
}
const marketplacePreview = (input = {}) => {
  if (marketplaceScenario === 'analysis-pending') {
    // First opening without cache: the plain preview reports the analysis; the analyzing request returns its options.
    const variant = masterFixture.variants[0];
    const field = 'attr_1000463';
    const analyzed = input.analyzeAutofill === true;
    const product = analyzed ? { ...masterFixture, marketplaceAutofill: { shein: [{ id: variant.id, values: { [field]: 'Vidrio' }, inferredFields: [], tentativeFields: [] }] } } : masterFixture;
    const category = { ...exportCategories[0], validationMode: 'template', columns: [...exportCategories[0].columns, {
      key: field, label: 'Materiales en contacto con alimentos', index: 2, letter: 'C', required: true, dropdownOptions: ['Acero inoxidable', 'Vidrio'],
    }] };
    return { clientName: 'Cliente local', products: [product], templates: exportTemplates, categories: [category], ...(analyzed ? {} : { autofillPending: true }),
      channels: [{ marketplaceId: 'shein', ready: analyzed, compatibleTemplates: 1, issues: analyzed ? [] : [{
        marketplaceId: 'shein', productId: product.id, productName: product.values.name, field, variantId: variant.id, code: 'required',
        message: 'Falta Materiales en contacto con alimentos en variante 1.',
      }] }] };
  }
  if (marketplaceScenario === 'tentative-suggestion' || marketplaceScenario === 'multiple-suggestions') {
    const secondVariant = { id: 'second-variant', values: {} };
    const multiple = marketplaceScenario === 'multiple-suggestions';
    const variant = masterFixture.variants[0];
    const field = 'attr_1000463';
    const corrected = Boolean(masterFixture.marketplaces.shein.rows?.find(row => row.id === variant.id)?.values[field]);
    const reason = 'Sugiere acero inoxidable por el acabado metálico; la composición del interior está por verificar.';
    const product = { ...masterFixture, variants: multiple ? [...masterFixture.variants, secondVariant] : masterFixture.variants, marketplaceAutofill: {
      shein: [{ id: variant.id, values: { [field]: 'Acero inoxidable' }, inferredFields: [], tentativeFields: [field], reasons: { [field]: reason } },
        ...(multiple ? [{ id: secondVariant.id, values: { [field]: 'Vidrio' }, inferredFields: [], tentativeFields: [field] }] : [])],
    } };
    const category = { ...exportCategories[0], validationMode: 'template', columns: [...exportCategories[0].columns, {
      key: field, label: 'Materiales en contacto con alimentos', index: 2, letter: 'C', required: true, dropdownOptions: ['Acero inoxidable', 'Vidrio'],
    }] };
    return { clientName: 'Cliente local', products: [product], templates: exportTemplates, categories: [category], channels: [{
      marketplaceId: 'shein', ready: true, compatibleTemplates: 1, issues: corrected ? [] : [{
        marketplaceId: 'shein', productId: product.id, productName: product.values.name, field, blocking: false,
        variantId: variant.id, code: 'verify_suggestion', message: `Materiales en contacto con alimentos (variante 1): Gemini sugiere «Acero inoxidable» con poca certeza. ${reason}`,
      }, ...(multiple ? [{
        marketplaceId: 'shein', productId: product.id, productName: product.values.name, field, blocking: false,
        variantId: secondVariant.id, code: 'verify_suggestion', message: 'Materiales en contacto con alimentos (variante 2): Gemini sugiere «Vidrio» con poca certeza.',
      }] : [])],
    }] };
  }
  if (marketplaceScenario === 'single-requirement') {
    const product = { ...masterFixture, variants: [...masterFixture.variants, { id: 'second-variant', values: {} }] };
    return { clientName: 'Cliente local', products: [product], templates: exportTemplates, categories: exportCategories, channels: [{
      marketplaceId: 'shein', ready: false, compatibleTemplates: 1, issues: [{
        marketplaceId: 'shein', productId: product.id, productName: product.values.name, field: 'sku',
        variantId: 'second-variant', code: 'required', message: 'Falta SKU en variante 2.',
      }],
    }] };
  }
  return ({ clientName: 'Cliente local', products: [masterFixture], templates: marketplaceScenario === 'historical' ? [
  ...exportTemplates.map(t => t.id === 'export-shein' ? { ...t, status: 'archived', exportConfig: { ...t.exportConfig, supersededByTemplateId: 'export-shein-next' } } : t),
  { ...exportTemplates[0], id: 'export-shein-next', exportConfig: { ...exportTemplates[0].exportConfig, version: 2 } },
] : exportTemplates, categories: exportCategories,
  channels: (marketplaceScenario === 'none' ? [] : marketplaceScenario === 'amazon-disabled' ? ['shein'] : marketplaceScenario === 'missing' ? ['shein', 'tiktok-shop'] : ['shein', 'mercado-libre', 'tiktok-shop', 'amazon']).map((marketplaceId, i) => ({ marketplaceId, compatibleTemplates: marketplaceScenario === 'missing' && i === 0 ? 0 : 1, ready: marketplaceScenario !== 'missing', issues: marketplaceScenario === 'missing' ? i === 0
    ? [{ marketplaceId, code: 'template', message: 'Falta plantilla compatible.' }]
    : [{ marketplaceId, code: 'required', message: 'Falta SKU de la variante.' }, {
      marketplaceId, productId: masterFixture.id, productName: 'Producto local', field: 'name', variantId: masterFixture.variants[0].id,
      code: 'required', message: 'Falta el nombre.',
    }]
    : [] })) });
};
export const httpsCallable = (_, name) => async input => {
  (window.__localCalls ||= []).push({ name, input });
  if (window.__photoEditFixture && ['editJobPhoto', 'selectJobOutput', 'regenerateJob'].includes(name)) {
    const current = records.jobs[0];
    if (name === 'editJobPhoto' && window.__photoEditError) throw new Error('Proveedor de edición no disponible');
    if (name === 'selectJobOutput') {
      current.userSelectedOutputId = input.outputId;
      current.userSelectedOutput = records[`jobs/${current.id}/outputs`].find(output => output.id === input.outputId);
      listeners.forEach(emit => emit());
    }
    return { data: { success: true, jobId: input.jobId } };
  }
  if (productWorkflow && name === 'organizerAction') {
    if (input.action === 'clients') return { data: { items: [{ ...client, configured: true }], next: null } };
    if (input.clientId !== client.id) throw new Error('Cliente fuera de tu alcance.');
    if (input.action === 'config') return { data: { clientId: client.id, clientName: client.name, watcher: 'disabled', sourceIds: [], operatorUids: [], directories: {} } };
    if (input.action === 'products') return { data: { items: [workflowVariant], next: null } };
    if (input.variantId !== workflowVariant.id || input.baseProductId && input.baseProductId !== workflowContext.baseProductId)
      throw new Error('Variante no disponible.');
    if (input.action === 'workflow') {
      const created = sessionStorage.getItem('tuto-workflow-item');
      const history = [...(created ? [{ ...workflowHistory(), batchId: 'new-workflow-batch', createdAt: 2, itemIds: [created] }] : []), ...(productWorkflow.historical ? [workflowHistory()] : [])];
      const generations = input.batchId ? history.filter(item => item.batchId === input.batchId) : history;
      if (input.batchId && !generations.length) throw new Error('El lote no pertenece a la variante solicitada.');
      return { data: { context: workflowContext, baseName: 'Jarras', variant: workflowVariant, variants: [workflowVariant],
        references: [{ id: 'reference', name: 'Jarra.jpg', view: 'Principal', sourceUrl: null }], generations, pendingAutomation: 0 } };
    }
    if (input.action === 'draft') {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 120;
      canvas.getContext('2d').fillRect(0, 0, 120, 120);
      return { data: { context: workflowContext, name: 'Jarra azul', kind: 'product', color: 'Azul',
        photos: [{ name: 'jarra.jpg', base64: canvas.toDataURL('image/jpeg').split(',')[1], view: null }] } };
    }
  }
  if (productWorkflow && name === 'createProductGenerationBatch') {
    if (input.organizerContext?.variantId !== workflowVariant.id || input.items.length !== 1) return unexpected();
    sessionStorage.setItem('tuto-workflow-item', input.items[0].id);
    restoreWorkflowBatch();
    listeners.forEach(emit => emit());
    return { data: { batchId: 'new-workflow-batch', createdJobs: input.scenes.length } };
  }
  if (name === 'saveMasterProduct') { masterFixture = { ...masterFixture, values: input.values, variants: input.variants, marketplaces: { ...masterFixture.marketplaces, ...input.marketplaces }, revision: masterFixture.revision + 1 }; return { data: { success: true, revision: masterFixture.revision } }; }
  if (name === 'previewMarketplaceExports') {
    if (input.analyzeAutofill) await new Promise(resolve => { window.__finishMarketplaceAnalysis = resolve; });
    const data = marketplacePreview(input);
    const batchId = input.batchIds[0];
    if (productWorkflow) {
      if (input.masterProductId !== 'local-master' || input.organizerContext?.variantId !== workflowVariant.id) return unexpected();
      data.channels = [{ marketplaceId: 'shein', ready: false, compatibleTemplates: 1, issues: [{ marketplaceId: 'shein', code: 'required', productId: 'local-master', field: 'material', message: 'Falta el material.' }] }];
    }
    if (batchId && batchId === window.__dashboardExportError) throw new Error('Error de exportación simulado');
    if (dashboard && batchId === 'blocked-batch') data.channels = data.channels.map(channel => ({
      ...channel, ready: false, issues: [{ code: 'required', message: 'Falta SKU de la variante.' }],
    }));
    return { data };
  }
  if (dashboard && name === 'selectJobOutput') {
    const job = records.jobs.find(item => item.id === input.jobId);
    if (!job || job.currentOutput?.id !== input.outputId) return unexpected();
    job.userSelectedOutputId = input.outputId;
    job.userSelectedOutput = job.currentOutput;
    listeners.forEach(emit => emit());
    return { data: { success: true, ...input } };
  }
  if (name === 'publishMarketplaceImages') {
    const image = { outputId: 'local-output', jobId: 'local-job', sourceStoragePath: 'fixtures/catalog.svg', marketplaceId: input.marketplaceId, profileVersion: 'jpeg-v1', bucket: 'local-marketplace-images', storagePath: `images/${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}.jpg`, url: `https://storage.googleapis.com/local-marketplace-images/images/${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}.jpg`, contentType: 'image/jpeg', width: 1200, height: 1200, bytes: 10000, publishedAt: stamp, publishedByUid: 'local-admin' };
    masterFixture.publishedImages = { ...masterFixture.publishedImages, [input.marketplaceId]: { 'local-output': image } };
    masterFixture.marketplaces[input.marketplaceId].imageUrls = { 'local-output': image.url };
    return { data: { images: [image], failures: [] } };
  }
  if (name === 'downloadMarketplaceExports') return { data: { fileName: input.marketplaceIds.length === 1 ? 'fixture.xlsx' : 'fixture.zip', downloadUrl: '/__tuto_fixture.svg', expiresAt: Date.now() + 900000, failures: [], exportedMarketplaces: input.marketplaceIds } };
  if (name === 'listClients') return { data: { clients: records.clients, page: 1, hasMore: false } };
  if (name === 'generateModelPose') return { data: {
    photos: Array.from({ length: input.count }, (_, i) => ({ storagePath: `fixtures/${input.stage}-${i}.svg`, contentType: 'image/svg+xml' })),
    errors: [], estimatedCostUsd: 0,
  } };
  if (name === 'saveModel') {
    const model = { id: input.id || 'local-model', clientId: input.clientId, name: input.name, status: 'active', active: true,
      poses: input.posesToAdd.map((pose, i) => ({ ...pose, id: `pose-${i}` })) };
    records.models.push(model);
    sessionStorage.setItem('tuto-local-models', JSON.stringify(records.models));
    listeners.forEach(emit => emit());
    return { data: { id: model.id } };
  }
  if (name === 'getSystemHealth') return { data: { overallStatus: 'healthy', summary: 'Fixture local', providers: [], alerts: [] } };
  return unexpected();
};
