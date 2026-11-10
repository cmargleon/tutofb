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
const listeners = new Set();
export const collection = (_, ...parts) => ({ path: parts.join('/'), kind: 'collection', constraints: [] });
export const collectionGroup = collection;
export const doc = (_, ...parts) => ({ path: parts.join('/'), kind: 'doc' });
export const query = (reference, ...constraints) => ({ ...reference, constraints });
export const where = (field, op, value) => ({ field, op, value });
export const orderBy = () => ({});
export const limit = () => ({});
export const startAfter = () => ({});
const snapshotDoc = value => ({ id: value?.id, exists: () => !!value, data: () => value });
function snapshot(reference) {
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
  const docs = rows.map(snapshotDoc);
  return { docs, size: docs.length, empty: !docs.length, forEach: callback => docs.forEach(callback), docChanges: () => [] };
}
export const onSnapshot = (reference, callback) => {
  const emit = () => callback(snapshot(reference)); listeners.add(emit); queueMicrotask(emit);
  return () => listeners.delete(emit);
};
export const getDocs = async reference => snapshot(reference);
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
const marketplacePreview = () => ({ clientName: 'Cliente local', products: [masterFixture], templates: marketplaceScenario === 'historical' ? [
  ...exportTemplates.map(t => t.id === 'export-shein' ? { ...t, status: 'archived', exportConfig: { ...t.exportConfig, supersededByTemplateId: 'export-shein-next' } } : t),
  { ...exportTemplates[0], id: 'export-shein-next', exportConfig: { ...exportTemplates[0].exportConfig, version: 2 } },
] : exportTemplates, categories: exportCategories,
  channels: (marketplaceScenario === 'none' ? [] : marketplaceScenario === 'amazon-disabled' ? ['shein'] : marketplaceScenario === 'missing' ? ['shein', 'tiktok-shop'] : ['shein', 'mercado-libre', 'tiktok-shop', 'amazon']).map((marketplaceId, i) => ({ marketplaceId, compatibleTemplates: marketplaceScenario === 'missing' && i === 0 ? 0 : 1, ready: marketplaceScenario !== 'missing', issues: marketplaceScenario === 'missing' ? [{ marketplaceId, code: i === 0 ? 'template' : 'required', message: i === 0 ? 'Falta plantilla compatible.' : 'Falta SKU de la variante.' }] : [] })) });
export const httpsCallable = (_, name) => async input => {
  (window.__localCalls ||= []).push({ name, input });
  if (name === 'saveMasterProduct') { masterFixture = { ...masterFixture, values: input.values, variants: input.variants, marketplaces: { ...masterFixture.marketplaces, ...input.marketplaces }, revision: masterFixture.revision + 1 }; return { data: { success: true, revision: masterFixture.revision } }; }
  if (name === 'previewMarketplaceExports') return { data: marketplacePreview() };
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
