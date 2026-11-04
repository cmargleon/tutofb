import type { GenerationKind } from './types/common';
export interface ClassifiedItemKind {
    itemKind?: GenerationKind | null;
    itemKindConfidence?: number | null;
    itemKindOverride?: GenerationKind | null;
    analysisStatus?: string;
}
export const effectiveItemKind = (item: ClassifiedItemKind): GenerationKind | null => item.itemKindOverride || ((item.itemKindConfidence ?? 0) >= 0.65 ? item.itemKind ?? null : null);
export const majorityItemKind = (items: ClassifiedItemKind[]): GenerationKind | null => {
    if (!items.length || items.some((item) => item.analysisStatus !== 'ready' || !effectiveItemKind(item)))
        return null;
    const garments = items.filter((item) => effectiveItemKind(item) === 'garment').length;
    const products = items.length - garments;
    return garments === products ? null : garments > products ? 'garment' : 'product';
};
