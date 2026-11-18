const records = new Map(Array.from({ length: 26 }, (_, i) => {
  const id = `master-${String(i).padStart(2, '0')}`;
  return [id, { id, clientId: 'local-client', values: { name: `Camisa ${String(i).padStart(2, '0')}`, sku: `000${i}`, brand: 'Tuto', currency: 'MXN', price: '199' }, variants: [{ id: `variant-${i}`, values: { sku: `000${i}`, color: 'Azul' }, attributes: {} }], marketplaces: {}, revision: 1, updatedAt: 1795000000000, updatedByUid: 'local-admin', catalog: { version: 1, status: 'draft', createdAt: 1795000000000, evidence: {}, attributes: {}, issues: [], searchKeys: [] } }];
}));
export function catalogFixtureCall(name, input) {
  if (name === 'listCatalogProducts') {
    const products = [...records.values()].sort((a, b) => a.id.localeCompare(b.id)).filter(p => (!input.cursor || p.id > input.cursor) && (!input.status || p.catalog.status === input.status) && (!input.search || `${p.values.name} ${p.values.sku}`.toLowerCase().includes(input.search.toLowerCase())));
    return { data: { products: products.slice(0, 25), nextCursor: products.length > 25 ? products[24].id : null } };
  }
  if (name === 'getCatalogProduct') return { data: { product: structuredClone(records.get(input.productId)), links: [], nextCursor: null } };
  if (name === 'saveCatalogProduct') {
    if (window.__catalogConflict) throw new Error('La ficha cambió. Recarga antes de guardar.');
    const previous = records.get(input.productId);
    const product = { ...previous, ...input, id: input.productId, marketplaces: previous?.marketplaces || {}, revision: (previous?.revision || 0) + 1, updatedAt: 1795000000000,
      catalog: { ...previous?.catalog, version: 1, createdAt: 1795000000000, status: input.status, attributes: input.attributes, evidence: {}, issues: [], searchKeys: [] } };
    records.set(product.id, product); return { data: { productId: product.id, revision: product.revision } };
  }
  if (name === 'listCatalogLegacyBatches') return { data: { batches: [{ id: 'legacy-batch', createdAt: 1795000000000 }], nextCursor: null } };
  if (name === 'previewCatalogImport') return { data: { candidates: [{ product: { id: 'legacy-product', clientId: 'local-client', garmentId: 'g', values: { name: 'Camisa del histórico' }, variants: [{ id: 'legacy-row', values: { sku: '0000' } }] }, fingerprint: 'source-fingerprint', linkedProductId: null, currentRevision: 0, possibleDuplicateIds: ['master-00'] }] } };
  if (name === 'applyCatalogImport') return { data: { productId: input.productId, revision: input.expectedRevision + 1 } };
}
