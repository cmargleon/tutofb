import type { MarketplaceId } from './marketplaces';
import type { PhotoArticleAttributes, PhotoPlanInput, PhotoRecipe, PhotoRecipeCategory, PhotoRecipePreferences, PhotoRecipeSource, PhotoRecipeView } from './types/photoPlan';

export const PHOTO_RECIPE_VERSION = 'marketplace-photo-recipe-v1' as const;
export const PHOTO_RECIPE_VIEWS = ['side', 'back', 'detail'] as const satisfies readonly PhotoRecipeView[];
export const PHOTO_RECIPE_CATEGORIES = ['ordinary', 'bodysuit', 'fitted_child', 'underwear', 'swimwear', 'accessory'] as const satisfies readonly PhotoRecipeCategory[];

export const PHOTO_RECIPE_OPTIONS = {
  missingReference: ['omit', 'review'],
  mainBackground: ['white', 'neutral'],
  additionalBackground: ['white', 'neutral'],
  mainComposition: ['model', 'flat_lay'],
  additionalComposition: ['model', 'flat_lay'],
} as const satisfies Partial<Record<keyof PhotoRecipePreferences, readonly string[]>>;
export type PhotoRecipeOption = keyof typeof PHOTO_RECIPE_OPTIONS;

export function photoRecipeAllowsOption(channel: MarketplaceId, field: PhotoRecipeOption, category?: PhotoRecipeCategory) {
  if (field === 'mainBackground') return channel === 'mercado-libre' || channel === 'shein';
  if (field === 'mainComposition' || field === 'additionalComposition')
    return channel === 'shein' || (channel === 'tiktok-shop' && (!category || category === 'underwear'));
  return true;
}

export function photoRecipeAllowsAppearance(channel: MarketplaceId, field: Exclude<PhotoRecipeOption, 'missingReference'>, category: PhotoRecipeCategory | null,
  audience: PhotoArticleAttributes['audience']['value'], pack: boolean, fixedFlatLay: boolean) {
  if (!photoRecipeAllowsOption(channel, field, category ?? undefined)) return false;
  if (field === 'mainBackground') return !pack;
  if (field === 'additionalBackground') {
    if (channel === 'mercado-libre' && pack) return false;
    return !(channel === 'tiktok-shop' && (audience === 'child' || audience === 'baby'));
  }
  return !fixedFlatLay && (channel !== 'tiktok-shop' || (audience === 'adult' && category === 'underwear'));
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function isPhotoRecipe(value: unknown, channel: MarketplaceId): value is PhotoRecipe {
  if (!isRecord(value) || !isRecord(value.categories) || Object.keys(value).some(key => key !== 'general' && key !== 'categories')) return false;
  const validPreferences = (preferences: unknown, category?: PhotoRecipeCategory) => isRecord(preferences) && Object.entries(preferences).every(([key, entry]) => {
    if (key === 'views') return Array.isArray(entry) && entry.length <= PHOTO_RECIPE_VIEWS.length
      && new Set(entry).size === entry.length && entry.every(view => PHOTO_RECIPE_VIEWS.includes(view));
    if (!Object.hasOwn(PHOTO_RECIPE_OPTIONS, key)) return false;
    const option = key as PhotoRecipeOption;
    return photoRecipeAllowsOption(channel, option, category) && (PHOTO_RECIPE_OPTIONS[option] as readonly unknown[]).includes(entry);
  });
  return validPreferences(value.general) && Object.entries(value.categories).every(([key, preferences]) =>
    (PHOTO_RECIPE_CATEGORIES as readonly string[]).includes(key) && validPreferences(preferences, key as PhotoRecipeCategory));
}

export function effectivePhotoRecipe(recipe: PhotoRecipe | undefined, category: PhotoRecipeCategory | null) {
  const exception = category ? recipe?.categories[category] : undefined;
  const preferences = { views: [...PHOTO_RECIPE_VIEWS], missingReference: 'omit' as const, ...recipe?.general, ...exception };
  const fields = ['views', ...Object.keys(PHOTO_RECIPE_OPTIONS)] as Array<keyof PhotoRecipePreferences>;
  const sources = Object.fromEntries(fields.map(key => [key,
    exception?.[key] !== undefined ? 'category' : recipe?.general[key] !== undefined ? 'client' : 'default',
  ])) as Record<keyof PhotoRecipePreferences, PhotoRecipeSource>;
  return { preferences, sources };
}

export function photoRecipeRevisions(channels: readonly MarketplaceId[], marketplaces: PhotoPlanInput['marketplaces']) {
  return channels.map(channel => {
    const config = marketplaces?.[channel];
    return { channel, revision: config?.photoRecipe ? config.photoRecipeRevision ?? 0 : 0 };
  });
}
