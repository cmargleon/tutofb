import type { OrganizerCommercialSource, OrganizerLinkConflict, StoredMasterProduct } from '../../../shared/src/types';
import { catalogMetadata, catalogDigest } from '../catalog/model';

type Resolutions = Record<string, 'source' | 'target' | 'excel'>;
/** Explicit human merge. Generated filenames/AI placeholders yield to the source sheet; manual values never silently lose. */
export function mergeLinkedProduct(target: StoredMasterProduct, sources: StoredMasterProduct[], commercial: OrganizerCommercialSource,
  resolutions: Resolutions = {}) {
  const result: StoredMasterProduct = { ...target, values: { ...target.values }, variants: target.variants.map(v => ({ ...v, values: { ...v.values } })), marketplaces: { ...target.marketplaces } };
  const conflicts: OrganizerLinkConflict[] = [];
  const evidence = { ...target.catalog?.evidence };
  const occurrences = new Map<string, number>();
  const decide = (field: string, before: string, incoming: string, excel: string) => {
    if (!before || before === incoming) return incoming || before;
    const count = occurrences.get(field) || 0; occurrences.set(field, count + 1);
    if (count) field = `${field}#${count + 1}`;
    const conflict = { field, source: incoming, target: before, excel };
    conflicts.push(conflict);
    const choice = resolutions[field];
    return choice === 'source' ? incoming : choice === 'excel' ? excel : before;
  };
  // Fill source sheet data first; preserve explicit edits on the target and record conflicts.
  for (const [field, value] of Object.entries(commercial.values)) {
    const key = field as keyof typeof result.values;
    const old = result.values[key] || '';
    const manual = target.catalog?.evidence[field]?.source === 'manual';
    result.values[key] = manual && old !== value ? decide(`values.${field}`, old, value!, value!) : value;
    if (!manual) evidence[field] = { original: value!, normalized: value!, source: 'drive', confidence: null, state: 'confirmed' };
  }
  const rows = new Map(result.variants.map(row => [row.id, row]));
  for (const variant of commercial.variants) {
    const current = rows.get(variant.id) || result.variants.find(row =>
      (variant.values.sku && row.values.sku === variant.values.sku) || (variant.values.skc && !variant.values.sku && row.values.skc === variant.values.skc));
    const row = { ...current, id: current?.id || variant.id, values: { ...current?.values }, attributes: { ...current?.attributes, ...variant.attributes } };
    for (const [field, value] of Object.entries(variant.values)) {
      const key = field as keyof typeof row.values;
      const path = `variant.${row.id}.${field}`;
      const old = row.values[key] || '';
      const manual = target.catalog?.evidence[path]?.source === 'manual';
      row.values[key] = manual && old !== value ? decide(path, old, value!, value!) : value;
      if (!manual) evidence[path] = { original: value!, normalized: value!, source: 'drive', confidence: null, state: 'confirmed' };
    }
    rows.set(row.id, row);
  }
  result.variants = [...rows.values()];
  for (const source of sources) {
    for (const [field, value] of Object.entries(source.values)) {
      if (source.catalog?.evidence[field]?.source !== 'manual') continue;
      const key = field as keyof typeof result.values;
      const path = `values.${field}`;
      result.values[key] = decide(path, result.values[key] || '', value!, commercial.values[key] || '');
      evidence[field] = source.catalog.evidence[field];
    }
    for (const variant of source.variants) for (const [field, value] of Object.entries(variant.values)) {
      const prior = source.catalog?.evidence[`variant.${variant.id}.${field}`];
      if (prior?.source !== 'manual') continue;
      // A placeholder has no commercial code; apply its reviewed common attributes to the selected visual variant's size rows.
      const matching = result.variants.filter(row => commercial.variants.some(v => v.id === row.id || v.values.sku && v.values.sku === row.values.sku) &&
        (!variant.values.sku || variant.values.sku === row.values.sku));
      for (const row of matching) {
        const key = field as keyof typeof row.values; const path = `variant.${row.id}.${field}`;
        row.values[key] = decide(path, row.values[key] || '', value!, commercial.variants.find(v => v.id === row.id)?.values[key] || '');
        evidence[path] = prior;
      }
    }
    for (const [channel, data] of Object.entries(source.marketplaces)) {
      const key = channel as keyof typeof result.marketplaces;
      const old = result.marketplaces[key];
      if (!old) result.marketplaces[key] = data;
      else if (catalogDigest(old) !== catalogDigest(data)) {
        const selected = decide(`marketplaces.${channel}`, JSON.stringify(old), JSON.stringify(data), JSON.stringify(old));
        result.marketplaces[key] = JSON.parse(selected);
      }
    }
  }
  // A human resolution changes both the value and its evidence; never retain the discarded value's provenance.
  const refreshEvidence = (path: string, value: string, excel: string | undefined) => {
    if (!evidence[path] || evidence[path].normalized === value) return;
    const fromSheet = excel === value;
    evidence[path] = { original: value, normalized: value, source: fromSheet ? 'drive' : 'manual', confidence: fromSheet ? null : 1, state: value ? 'confirmed' : 'empty' };
  };
  for (const [field, value] of Object.entries(result.values)) refreshEvidence(field, value!, commercial.values[field as keyof typeof commercial.values]);
  for (const row of result.variants) for (const [field, value] of Object.entries(row.values)) {
    const excel = commercial.variants.find(v => v.id === row.id || v.values.sku && v.values.sku === row.values.sku);
    refreshEvidence(`variant.${row.id}.${field}`, value!, excel?.values[field as keyof typeof row.values]);
  }
  result.catalog = catalogMetadata({ ...result, catalog: { ...result.catalog!, evidence,
    selectedImages: [...new Map([...(result.catalog?.selectedImages || []), ...sources.flatMap(s => s.catalog?.selectedImages || [])]
      .map(image => [`${image.jobId}:${image.outputId}`, image])).values()],
    photos: [...new Map([...(result.catalog?.photos || []), ...sources.flatMap(s => s.catalog?.photos || [])]
      .map(photo => [photo.jobId, { ...photo, variantId: result.variants.some(v => v.id === photo.variantId) ? photo.variantId : commercial.variants[0]?.id || null }])).values()],
    issues: [...(result.catalog?.issues || []), ...sources.flatMap(s => s.catalog?.issues || [])].filter(issue => issue.kind !== 'identity'),
  } }, target.catalog?.createdAt || null);
  return { product: result, conflicts };
}
