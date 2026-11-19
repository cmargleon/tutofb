import type { CatalogPhoto, CatalogProductGroup, Job, MasterVariant } from '../types';
import { isApprovedProductPhoto } from '../productWorkflow';
import { resolveApprovedJobOutput } from '../domain';
import { CATALOG_FAMILIES, catalogTypeId, familyOfType, type CatalogFamily } from './families';
import { routeMarketplaceCategory } from './routing';

/**
 * The client template splits products into clothing and everything else (ROPA / OBJETOS); the universal
 * families refine "objetos" into kitchen, home, toys…
 */
export const CATALOG_PRODUCT_GROUPS: Array<{ id: CatalogProductGroup; label: string }> = [
  { id: 'ropa', label: 'Ropa' }, { id: 'objetos', label: 'Objetos' },
];
export const catalogGroupOfFamily = (familyId: string): CatalogProductGroup => familyId === 'ropa' ? 'ropa' : 'objetos';
export const catalogFamiliesOfGroup = (group: CatalogProductGroup | ''): CatalogFamily[] =>
  group ? CATALOG_FAMILIES.filter(family => catalogGroupOfFamily(family.id) === group) : CATALOG_FAMILIES;
export const catalogTypeLabel = (typeId: string) => familyOfType(typeId)?.productTypes.find(type => type.id === typeId)?.label ?? typeId;

/**
 * Universal product type of a master product from its free-text category: an exact template value first,
 * otherwise the same keyword routing that maps marketplace categories ("Suéteres mujer" → Suéter).
 */
export function classifyCatalogCategory(category: string | undefined | null) {
  const text = category?.trim() ?? '';
  const exact = text ? familyOfType(catalogTypeId(text)) && catalogTypeId(text) : null;
  const typeId = exact || (text ? routeMarketplaceCategory('shein', text).typeIds[0] : undefined) || null;
  const familyId = typeId ? familyOfType(typeId)?.id ?? null : null;
  return { typeId: familyId ? typeId : null, familyId, group: familyId ? catalogGroupOfFamily(familyId) : null };
}

export const catalogBrowseProjection = (values: { category?: string }) => ({ listed: true, ...classifyCatalogCategory(values.category) });

/** Photo entry of a generation job, before attributing it to a canonical variant. */
export function catalogPhotoFromJob(job: Job & { id: string }): (Omit<CatalogPhoto, 'variantId'> & { sourceVariantId: string }) | null {
  const output = resolveApprovedJobOutput(job);
  if (job.status !== 'completed' || job.manuallyFlagged || !output?.id || !output.resultImagePath || output.storageDeletedAt) return null;
  const destinations = job.photoTask?.destinations ?? [];
  const main = destinations.filter(d => d.role === 'main');
  const positions = (main.length ? main : destinations).map(d => d.position);
  return {
    jobId: job.id, batchId: job.batchId, outputId: output.id, storagePath: output.resultImagePath, thumbnailPath: output.thumbnailPath || null,
    approved: isApprovedProductPhoto(job, output),
    role: main.length ? 'main' : destinations.length ? 'alternative' : null,
    position: positions.length ? Math.min(...positions) : null,
    view: job.photoTask?.view ?? null,
    sourceVariantId: job.photoTask?.variantId ?? job.garmentId,
  };
}

const variantSkcKey = (variant: Pick<MasterVariant, 'values'>) =>
  variant.values?.skc?.trim() || variant.values?.color?.trim().toLocaleLowerCase('es') || '';

/**
 * Canonical variant of a source variant: the generation link map, the same id, or — since photos are taken
 * per SKC while variants are per size — the first variant when every variant belongs to the same SKC.
 */
export function attributeCatalogVariant(sourceVariantId: string, variants: Pick<MasterVariant, 'id' | 'values'>[], variantMap: Record<string, string> = {}) {
  const mapped = variantMap[sourceVariantId] || sourceVariantId;
  if (variants.some(v => v.id === mapped)) return mapped;
  if (variants.length === 1) return variants[0].id;
  const keys = new Set(variants.map(variantSkcKey));
  return variants.length && keys.size === 1 && !keys.has('') ? variants[0].id : null;
}

const photoRank = (photo: CatalogPhoto) => [photo.approved ? 0 : 1, photo.role === 'main' ? 0 : photo.role === 'alternative' ? 1 : 2, photo.position ?? 999];
const comparePhotos = (a: CatalogPhoto, b: CatalogPhoto) => {
  const [x, y] = [photoRank(a), photoRank(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return a.jobId.localeCompare(b.jobId);
};
/** Photos in display order: approved first, then the channel main image and its position. */
export const sortCatalogPhotos = (photos: CatalogPhoto[]) => [...photos].sort(comparePhotos);
export const mainCatalogPhoto = (photos: CatalogPhoto[]) => sortCatalogPhotos(photos)[0] ?? null;

export interface CatalogVariantGroup {
  /** SKC code, or a fallback key when the variant has none. */
  key: string; skc: string | null; color: string | null;
  variants: MasterVariant[]; photos: CatalogPhoto[]; main: CatalogPhoto | null;
}
/**
 * SPU → SKC grouping for the product list: sizes of one colour share a SKC and its photos.
 * Photos not attributable to a variant are returned apart.
 */
export function groupCatalogVariants(variants: MasterVariant[], photos: CatalogPhoto[] = []) {
  const groups = new Map<string, CatalogVariantGroup>();
  const byVariant = new Map<string, string>();
  for (const variant of variants) {
    const skc = variant.values.skc?.trim() || null;
    const color = variant.values.color?.trim() || null;
    const key = skc ? `skc:${skc}` : color ? `color:${color.toLocaleLowerCase('es')}` : `variant:${variant.id}`;
    if (!groups.has(key)) groups.set(key, { key, skc, color, variants: [], photos: [], main: null });
    groups.get(key)!.variants.push(variant);
    byVariant.set(variant.id, key);
  }
  const unassigned: CatalogPhoto[] = [];
  for (const photo of photos) {
    const key = photo.variantId ? byVariant.get(photo.variantId) : undefined;
    if (key) groups.get(key)!.photos.push(photo); else unassigned.push(photo);
  }
  const result = [...groups.values()].map(group => ({ ...group, photos: sortCatalogPhotos(group.photos), main: mainCatalogPhoto(group.photos) }));
  return { groups: result, unassigned: sortCatalogPhotos(unassigned) };
}
