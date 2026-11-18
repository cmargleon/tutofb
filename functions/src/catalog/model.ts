import { createHash } from 'node:crypto';
import type { CatalogIssue, CatalogMetadata, MasterProduct, ProductEvidence, StoredMasterProduct } from '../../../shared/src/types';

const stable = (value: any): any => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    if (typeof value.toJSON === 'function') return stable(value.toJSON());
    return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  }
  return value;
};
export const catalogDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export const normalizeCatalogSearch = (value: string) => value.normalize('NFKC').toLocaleLowerCase('es').trim();
export function catalogSearchKeys(values: MasterProduct['values'], variants: MasterProduct['variants']) {
  const keys = new Set<string>();
  for (const text of [values.sku, ...variants.flatMap(v => [v.values.sku, v.values.skc, v.values.spu])]) {
    if (text) keys.add(normalizeCatalogSearch(text));
  }
  for (const text of [values.name]) {
    if (!text) continue;
    for (const word of [text, ...text.split(/\s+/).slice(0, 20)]) {
      const key = normalizeCatalogSearch(word);
      for (let length = 1; length <= Math.min(key.length, 100); length++) keys.add(key.slice(0, length));
    }
  }
  return [...keys].sort();
}
export const manualEvidence = (value: string): ProductEvidence => ({ original: value, normalized: value, source: 'manual', confidence: 1, state: value === '' ? 'empty' : 'confirmed' });
export function catalogMetadata(product: Pick<StoredMasterProduct, 'values' | 'variants' | 'catalog'>, createdAt: CatalogMetadata['createdAt']): CatalogMetadata {
  return { version: 1, status: 'draft', createdAt, evidence: {}, attributes: {}, issues: [], ...product.catalog,
    searchKeys: catalogSearchKeys(product.values, product.variants) };
}
const priority = (e?: ProductEvidence) => e?.source === 'manual' ? 4 : e?.verified ? 3 : e?.source === 'ai' ? 1 : 2;
/** Existing overrides predate field provenance: conservatively treat every stored value as manual. */
export function mergeCatalogSource(current: StoredMasterProduct | undefined, source: MasterProduct, reference: string, variantMap: Record<string, string> = {}) {
  const values = { ...current?.values };
  const metadata = catalogMetadata({ values, variants: current?.variants || [], catalog: current?.catalog }, null);
  const evidence = { ...metadata.evidence };
  const issues = new Map(metadata.issues.map(issue => [issue.id, issue]));
  const conflict = (field: string, before: string, after: string) => {
    const id = catalogDigest([field, before, after, reference]);
    issues.set(id, { id, kind: 'conflict', field, current: before, incoming: after, reference });
  };
  const merge = (before: Record<string, string>, after: Record<string, string>, prefix = '', incomingEvidence: Record<string, ProductEvidence> = {}) => {
    const result = { ...before };
    for (const [key, value] of Object.entries(after)) {
      const field = prefix + key;
      const prior = evidence[field] || (Object.hasOwn(before, key) ? manualEvidence(before[key]) : undefined);
      const incoming = incomingEvidence[key] || { original: value, normalized: value, source: 'legacy' as const, confidence: null };
      if (Object.hasOwn(before, key) && before[key] !== value) {
        conflict(field, before[key], value);
        if (priority(prior) >= priority(incoming)) continue;
      }
      if (!Object.hasOwn(before, key) || before[key] !== value) {
        result[key] = value;
        evidence[field] = { ...incoming, reference, state: incoming.source === 'ai' ? 'suggested' : value === '' ? 'empty' : 'confirmed' };
      }
    }
    return result;
  };
  Object.assign(values, merge(values, source.values, '', source.evidence));
  // Legacy organizer overrides contain only patches. The confirmed import reconstructs their source rows.
  const base = current?.organizerOverrides && !current.catalog ? source.variants.map(v => {
    const patch = current.organizerOverrides!.variants.find(p => p.id === v.id);
    return { ...v, values: { ...v.values, ...patch?.values }, attributes: { ...v.attributes, ...patch?.attributes } };
  }).filter(v => !current.organizerOverrides!.removedVariantIds.includes(v.id)) : current?.variants || [];
  const variants = new Map(base.map(v => [v.id, v]));
  if (source.variants.some(v => Object.values(v.values).some(Boolean))) {
    const placeholder = variants.get(source.garmentId);
    if (placeholder && !Object.values(placeholder.values).some(Boolean) && !Object.keys(metadata.evidence).some(key => key.startsWith(`variant.${placeholder.id}.`))) variants.delete(source.garmentId);
  }
  for (const variant of source.variants) {
    if (variant.id === source.garmentId && !Object.values(variant.values).some(Boolean) && variants.size) continue;
    const id = variantMap[variant.id] || variant.id;
    const existing = variants.get(id);
    const prefix = `variant.${variant.id}.`;
    const visualEvidence = Object.fromEntries(Object.entries(source.evidence).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
    variants.set(id, { ...existing, id,
      values: merge(existing?.values || {}, variant.values, `variant.${id}.`, { ...visualEvidence, ...variant.evidence }),
      attributes: merge(existing?.attributes || {}, variant.attributes || {}, `attribute.${id}.`, visualEvidence),
      ...(existing?.evidence ? { evidence: existing.evidence } : {}),
    });
  }
  const rows = [...variants.values()];
  return { values, variants: rows, catalog: { ...metadata, evidence, issues: [...issues.values()].slice(-200), searchKeys: catalogSearchKeys(values, rows) } };
}
export const duplicateIssue = (productId: string, sku: string): CatalogIssue => ({ id: catalogDigest(['duplicate', productId, sku]), kind: 'possible_duplicate', field: 'sku', current: sku, incoming: sku, reference: productId });
