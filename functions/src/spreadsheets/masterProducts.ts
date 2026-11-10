import { createHash } from 'node:crypto';
import type { Batch, Job, MasterProduct, ProductDraft, StoredMasterProduct } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';

export const masterProductId = (batch: Pick<Batch, 'id' | 'automationJobId'>, garmentId: string) => createHash('sha256').update(`${batch.automationJobId || batch.id}\0${garmentId}`).digest('hex').slice(0, 40);
export const isApprovedMasterProductOutput = (job: Job, output = resolveApprovedJobOutput(job)): boolean => Boolean(
  job.status === 'completed' && !job.manuallyFlagged && output && typeof output.id === 'string' && output.id
  && typeof output.resultImagePath === 'string' && output.resultImagePath.startsWith(`generated/${job.clientId}/${job.batchId}/`)
  && (Boolean(job.userSelectedOutput?.id && job.userSelectedOutput.id === output.id) || output.autoReview?.verdict === 'approved'),
);
const productAliases: Record<string, string[]> = { name: ['goods_name', 'item_name', 'product_name', 'title'], description: ['goods_description', 'product_description', 'description'], brand: ['brand', 'brand_name'], material: ['material'], composition: ['composition'] };
const variantAliases: Record<string, string[]> = { sku: ['sku_code', 'item_sku', 'seller_sku', 'sku'], color: ['main_attribute_value', 'color', 'colour'], size: ['secondary_attribute_1_value', 'size'], price: ['price', 'standard_price', 'retail_price'], inventory: ['quantity', 'inventory'], gtin: ['gtin', 'ean', 'upc'], asin: ['asin'], spu: ['supplier_code'], skc: ['skc'] };
export function projectMasterProducts(clientId: string, batches: Batch[], jobs: Job[], drafts: ProductDraft[], stored: Record<string, StoredMasterProduct> = {}): MasterProduct[] {
  const products = new Map<string, MasterProduct>();
  const batchMap = new Map(batches.map(b => [b.id, b]));
  for (const item of [...drafts, ...jobs]) {
    const batch = batchMap.get(item.batchId);
    if (!batch || item.clientId !== clientId) throw new Error('Relación de producto fuera del cliente o lote.');
    const id = masterProductId(batch, item.garmentId);
    if (!products.has(id)) products.set(id, { id, clientId, garmentId: item.garmentId, batchIds: [], values: { name: item.garmentName || '' }, evidence: {}, variants: [], legacyDrafts: [], originalImages: [], generatedImages: [], approvedImages: [], pendingImages: 0, marketplaces: {}, revision: 0 });
    const p = products.get(id)!;
    if (!p.batchIds.includes(item.batchId)) p.batchIds.push(item.batchId);
    if ('rows' in item) {
      p.legacyDrafts.push(item);
      for (const [field, aliases] of Object.entries(productAliases)) {
        const value = aliases.map(key => item.rows[0]?.values[key]).find(Boolean);
        if (value) { p.values[field as keyof typeof p.values] = value; p.evidence[field] = { original: value, normalized: value, source: 'legacy', confidence: null }; }
      }
      for (const [key, suggestion] of Object.entries(item.inferredValues || {})) p.evidence[`legacy.${item.id}.${key}`] = { original: suggestion.value, normalized: suggestion.value, source: suggestion.source === 'user' ? 'manual' : suggestion.source === 'gemini' ? 'ai' : 'legacy', confidence: suggestion.confidence };
      if (!p.variants.length) p.variants = item.rows.map(r => ({ id: r.id, values: Object.fromEntries(Object.entries(variantAliases).map(([field, aliases]) => [field, aliases.map(key => r.values[key]).find(Boolean) || ''])) }));
      p.originalImages.push(...(item.originalImages || []).map(i => ({ storagePath: i.storagePath, fileName: i.fileName })));
    } else {
      const output = resolveApprovedJobOutput(item);
      // A manual selection is an explicit approval in the existing review flow.
      const approved = isApprovedMasterProductOutput(item, output);
      if (output?.id && output.resultImagePath && !p.generatedImages!.some(i => i.outputId === output.id)) p.generatedImages!.push({ outputId: output.id, jobId: item.id!, storagePath: output.resultImagePath, approved: Boolean(approved) });
      if (approved && output && !p.approvedImages.some(i => i.outputId === output.id)) p.approvedImages.push({ outputId: output.id, jobId: item.id!, storagePath: output.resultImagePath });
      else if (!approved) p.pendingImages++;
      if (item.garmentFilePath) p.originalImages.push({ storagePath: item.garmentFilePath, fileName: item.garmentName });
      for (const [index, storagePath] of [...(item.productReferencePaths || []), ...(item.automationReferencePaths || [])].entries()) p.originalImages.push({ storagePath, fileName: item.garmentOriginalFileNames?.[index] || item.garmentName });
      const ai = output?.autoReview?.marketplaceData;
      for (const [field, value] of Object.entries({ name: ai?.title, description: ai?.description, brand: ai?.brand, category: ai?.garmentType })) if (value) p.evidence[`ai.${item.id}.${field}`] = { original: value, normalized: value, source: 'ai', confidence: null };
    }
  }
  for (const p of products.values()) {
    if (!p.variants.length) p.variants = [{ id: p.garmentId, values: {} }];
    p.originalImages = p.originalImages.filter((image, i, all) => all.findIndex(v => v.storagePath === image.storagePath) === i);
    const saved = stored[p.id];
    if (saved) {
      if (saved.clientId !== clientId) throw new Error('Producto fuera del cliente.');
      p.values = { ...p.values, ...saved.values }; p.variants = saved.variants; p.marketplaces = saved.marketplaces; p.revision = saved.revision;
      for (const [key, value] of Object.entries(saved.values)) p.evidence[key] = { original: value!, normalized: value!, source: 'manual', confidence: 1 };
    }
  }
  return [...products.values()];
}
