import type { StoredMasterProduct } from '../../../../shared/src/types';
import { catalogTypeLabel, groupCatalogVariants, type CatalogVariantGroup } from '../../../../shared/src/clientCatalog/browse';
import { toDate } from '../../../../shared/src/utils/dateUtils';

export interface CatalogProductView {
  id: string; name: string; spu: string | null;
  typeLabel: string | null; rawCategory: string | null; createdAt: Date | null;
  groups: CatalogVariantGroup[]; unassigned: CatalogVariantGroup['photos'];
  skuCount: number; photoCount: number; batchIds: string[];
}

export const variantGroupLabel = (group: CatalogVariantGroup) => group.skc || group.color || 'Variante sin SKC';
export const variantGroupSizes = (group: CatalogVariantGroup) =>
  [...new Set(group.variants.map(v => v.values.size?.trim() || v.values.pack?.trim()).filter((value): value is string => Boolean(value)))];

/** SPU row of Catálogo → Productos: SKC groups with their main photo, from the stored master product. */
export function catalogProductView(product: StoredMasterProduct & { id: string }): CatalogProductView {
  const photos = product.catalog?.photos ?? [];
  const { groups, unassigned } = groupCatalogVariants(product.variants ?? [], photos);
  const spu = product.values?.sku?.trim() || product.variants?.find(v => v.values.spu)?.values.spu?.trim() || null;
  const typeId = product.catalog?.typeId;
  return {
    id: product.id,
    name: product.values?.name?.trim() || spu || 'Producto sin nombre',
    spu,
    typeLabel: typeId ? catalogTypeLabel(typeId) : null,
    rawCategory: product.values?.category?.trim() || null,
    createdAt: toDate(product.catalog?.createdAt),
    groups, unassigned,
    skuCount: (product.variants ?? []).filter(v => v.values.sku).length,
    photoCount: photos.length,
    batchIds: [...new Set(photos.map(photo => photo.batchId))],
  };
}
