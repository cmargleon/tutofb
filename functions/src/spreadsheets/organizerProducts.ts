import type { Batch, Client, Job, MasterProduct, MasterVariant, StoredMasterProduct } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { getAppFirestore } from '../firebase/appFirestore';
import { readOrganizerCommerce, type OrganizerCommercialLink } from '../organizer/commerce';
import { isApprovedMasterProductOutput } from './masterProducts';

export async function loadOrganizerProducts(client: Client, batches: Batch[], jobs: Job[]) {
  const db = getAppFirestore();
  const byBatch = new Map(batches.map(batch => [batch.id, batch]));
  const refs = [...new Set(jobs.flatMap(job => {
    const id = byBatch.get(job.batchId)?.automationJobId;
    return id ? [`automationJobs/${id}/organizerCommerce/${job.garmentId}`] : [];
  }))];
  const links = new Map<string, MasterProduct['organizer']>();
  const root = db.collection('organizers').doc(client.id!);
  for (let index = 0; index < refs.length; index += 25) {
    const snapshots = await db.getAll(...refs.slice(index, index + 25).map(path => db.doc(path)));
    await Promise.all(snapshots.map(async snapshot => {
      if (!snapshot.exists) return;
      const link = snapshot.data() as OrganizerCommercialLink;
      const current = await readOrganizerCommerce(root, link.photos, client.automation?.organizerGeneration?.sourceColumns);
      const classificationChanged = !current.source.issue && !link.source.issue &&
        (current.source.values.name !== link.source.values.name || current.source.values.category !== link.source.values.category ||
          current.organizerVariantId !== link.organizerVariantId);
      const category = link.category && classificationChanged ? {
        ...link.category, templateId: null, categoryId: null, version: null, confidence: null,
        reason: 'Cambió la identidad o categoría del Excel fuente. Revisa la categoría comercial.',
      } : link.category || null;
      links.set(snapshot.ref.path, { source: current.source, category });
    }));
  }
  return links;
}

export function applyOrganizerSource(product: MasterProduct, data: NonNullable<MasterProduct['organizer']>, jobs: Job[]) {
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
  const suggestions = jobs.flatMap(job => {
    const output = resolveApprovedJobOutput(job);
    return isApprovedMasterProductOutput(job, output) && output?.autoReview?.marketplaceData ? [output.autoReview.marketplaceData] : [];
  });
  const suggestion = suggestions[0];
  for (const [field, value] of Object.entries({ name: suggestion?.title, description: suggestion?.description, brand: suggestion?.brand })) {
    if (value && !data.source.values[field as keyof MasterProduct['values']]) {
      product.values[field as keyof MasterProduct['values']] = value;
      product.evidence[field] = { original: value, normalized: value, source: 'ai', confidence: null };
    }
  }
  for (const variant of product.variants) {
    variant.attributes = { ...Object.fromEntries(Object.entries({
      garmentType: suggestion?.garmentType, primaryColor: suggestion?.primaryColor, gender: suggestion?.gender, sport: suggestion?.sport,
    }).filter((entry): entry is [string, string] => Boolean(entry[1]))), ...variant.attributes };
  }
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
