import type { AutomationJob, Batch, Client, Job, MasterProduct, MasterVariant, PhotoArticleAttributes, StoredMasterProduct } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { getAppFirestore } from '../firebase/appFirestore';
import { readOrganizerCommerce, type OrganizerCommercialLink } from '../organizer/commerce';
import { isApprovedMasterProductOutput } from './masterProducts';

type OrganizerProduct = {
  organizer: NonNullable<MasterProduct['organizer']>;
  photoAttributes: Partial<PhotoArticleAttributes>[];
};

export async function loadOrganizerProducts(client: Client, batches: Batch[], jobs: Job[]) {
  const db = getAppFirestore();
  const byBatch = new Map(batches.map(batch => [batch.id, batch]));
  const referencesByItem = new Map<string, Set<string>>();
  const automationIds = new Set<string>();
  for (const job of jobs) {
    const id = byBatch.get(job.batchId)?.automationJobId;
    if (!id) continue;
    automationIds.add(id);
    const path = `automationJobs/${id}/organizerCommerce/${job.garmentId}`;
    const references = referencesByItem.get(path) || new Set<string>();
    for (const reference of job.automationReferencePaths || job.productReferencePaths || []) references.add(reference);
    referencesByItem.set(path, references);
  }
  const refs = [...referencesByItem.keys()];
  const evidence = new Map<string, Partial<PhotoArticleAttributes>[]>();
  if (automationIds.size) {
    const snapshots = await db.getAll(...[...automationIds].map(id => db.collection('automationJobs').doc(id)),
      { fieldMask: ['clientId', 'analysisCache'] });
    for (const snapshot of snapshots) {
      if (snapshot.get('clientId') !== client.id) continue;
      const analyses = snapshot.get('analysisCache') as AutomationJob['analysisCache'];
      for (const analysis of Object.values(analyses || {})) {
        if (!analysis.usedGemini || !analysis.photoAttributes || !analysis.photos?.length) continue;
        const path = `${snapshot.ref.path}/organizerCommerce/${analysis.garmentId}`;
        const references = referencesByItem.get(path);
        const analyzed = new Set(analysis.photos.map(photo => photo.storagePath));
        if (!references?.size || analyzed.size !== references.size || [...analyzed].some(reference => !references.has(reference))) continue;
        const group = evidence.get(path) || [];
        group.push(analysis.photoAttributes);
        evidence.set(path, group);
      }
    }
  }
  const links = new Map<string, OrganizerProduct>();
  const root = db.collection('organizers').doc(client.id!);
  for (let index = 0; index < refs.length; index += 25) {
    const snapshots = await db.getAll(...refs.slice(index, index + 25).map(path => db.doc(path)));
    await Promise.all(snapshots.map(async snapshot => {
      if (!snapshot.exists) return;
      const link = snapshot.data() as OrganizerCommercialLink;
      const current = await readOrganizerCommerce(root, link.photos, client.automation?.organizerGeneration?.sourceColumns, true);
      const classificationChanged = !current.source.issue && !link.source.issue &&
        (current.source.values.name !== link.source.values.name || current.source.values.category !== link.source.values.category ||
          current.organizerVariantId !== link.organizerVariantId);
      const category = link.category && classificationChanged ? {
        ...link.category, templateId: null, categoryId: null, version: null, confidence: null,
        reason: 'Cambió la identidad o categoría del Excel fuente. Revisa la categoría comercial.',
      } : link.category || null;
      links.set(snapshot.ref.path, {
        organizer: { source: current.source, category },
        photoAttributes: current.source.issue ? [] : evidence.get(snapshot.ref.path) || [],
      });
    }));
  }
  return links;
}

function agreedVisualAttribute<K extends 'color' | 'transparency'>(analyses: Partial<PhotoArticleAttributes>[], key: K) {
  const observations = analyses.flatMap(analysis => {
    const attribute = analysis[key];
    if (attribute?.source !== 'gemini' || typeof attribute.confidence !== 'number' || !Number.isFinite(attribute.confidence) ||
      attribute.confidence < 0.95 || attribute.confidence > 1 || !attribute.evidence?.trim()) return [];
    const value = attribute.value;
    if (key === 'color' && (typeof value !== 'string' || !value.trim() || value.length > 80)) return [];
    if (key === 'transparency' && typeof value !== 'boolean') return [];
    return [{ value: String(value).trim(), confidence: attribute.confidence, evidence: attribute.evidence }];
  });
  const normalize = (value: string) => value.normalize('NFC').toLowerCase();
  if (new Set(observations.map(observation => normalize(observation.value))).size !== 1) return undefined;
  return observations.sort((a, b) => b.confidence - a.confidence || a.value.localeCompare(b.value) || a.evidence.localeCompare(b.evidence))[0];
}

export function applyOrganizerSource(product: MasterProduct, { organizer: data, photoAttributes }: OrganizerProduct) {
  product.organizer = data;
  if (data.source.variants.length) product.variants = data.source.variants;
  for (const [field, value] of Object.entries(data.source.values)) {
    product.values[field as keyof MasterProduct['values']] = value;
    product.evidence[field] = { original: value, normalized: value, source: 'drive', confidence: null };
  }
  const category = data.category;
  if (category?.templateId && category.categoryId) product.marketplaces[category.marketplaceId] = {
    templateId: category.templateId, categoryId: category.categoryId,
  };
  const color = agreedVisualAttribute(photoAttributes, 'color');
  const transparency = agreedVisualAttribute(photoAttributes, 'transparency');
  product.variants = product.variants.map(variant => {
    const values = { ...variant.values };
    const attributes = { ...variant.attributes };
    if (color && !values.color) {
      values.color = color.value;
      product.evidence[`variant.${variant.id}.color`] = { original: color.evidence, normalized: color.value, source: 'ai', confidence: color.confidence };
    }
    if (transparency && !attributes.transparency) {
      attributes.transparency = transparency.value === 'true' ? 'Sí' : 'No';
      product.evidence[`variant.${variant.id}.transparency`] = {
        original: transparency.evidence, normalized: attributes.transparency, source: 'ai', confidence: transparency.confidence,
      };
    }
    return { ...variant, values, ...(Object.keys(attributes).length ? { attributes } : {}) };
  });
}

export function applyOrganizerVariantOverrides(variants: MasterVariant[], overrides: NonNullable<StoredMasterProduct['organizerOverrides']>) {
  const merged = new Map(variants.filter(variant => !overrides.removedVariantIds.includes(variant.id)).map(variant => [variant.id, variant]));
  for (const variant of overrides.variants) {
    const original = merged.get(variant.id);
    if (!original && !overrides.addedVariantIds.includes(variant.id) && !overrides.confirmedIdentity) continue;
    merged.set(variant.id, { ...variant, values: { ...original?.values, ...variant.values }, attributes: { ...original?.attributes, ...variant.attributes } });
  }
  return [...merged.values()];
}

export function assignOrganizerImages(product: MasterProduct, jobs: Job[], batches: Map<string, Batch>, client: Client) {
  if (product.photoAssignments) {
    // The same confirmed visual variant can cover multiple size or SKU rows.
    product.photoAssignments = product.variants.flatMap(variant => product.photoAssignments!.map(assignment => ({ ...assignment, variantId: variant.id })));
    return;
  }
  const ranked = [...jobs].sort((a, b) => {
    const batch = batches.get(a.batchId);
    if (a.batchId !== b.batchId) return a.batchId.localeCompare(b.batchId);
    if (a.productScene && b.productScene) return (batch?.productScenes?.findIndex(scene => scene.type === a.productScene) ?? 0) -
      (batch?.productScenes?.findIndex(scene => scene.type === b.productScene) ?? 0);
    return (batch?.poseIds.indexOf(a.poseImageId) ?? 0) - (batch?.poseIds.indexOf(b.poseImageId) ?? 0) || a.id!.localeCompare(b.id!);
  });
  product.photoAssignments = MARKETPLACES.filter(({ id }) => client.marketplaces?.[id]?.enabled).flatMap(({ id: channel }) =>
    product.variants.flatMap(variant => ranked.map((job, index) => {
      const output = resolveApprovedJobOutput(job);
      return {
        channel, productId: product.id, variantId: variant.id, position: index + 1,
        role: index === 0 ? 'main' as const : 'alternative' as const, required: index === 0, ruleIds: [],
        ...(index === 0 && channel === 'shein' ? { imageType: 1, imageSort: 1 } : {}),
        taskId: job.id!, jobId: job.id!, angle: job.productScene || job.poseImageId,
        outputId: output?.id || null, eligible: isApprovedMasterProductOutput(job, output),
      };
    })));
}
