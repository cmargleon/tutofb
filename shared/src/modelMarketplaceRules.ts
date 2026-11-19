import { MODEL_POSE_RECIPES } from './modelPoseRecipes';
import type { MarketplaceId } from './marketplaces';
import type { ModelMarketplaceAppearance, ModelMarketplaceRule, ModelMarketplaceRules } from './types/modelMarketplaceRules';

export const MODEL_RULE_SHOTS = ['front', 'front_three_quarter', 'commercial_back'] as const;
export const MODEL_RULE_RATIOS = ['client', '3:4', '4:3', '1:1'] as const;
export const MODEL_RULE_FRAMINGS = ['auto', 'upper_body', 'lower_body', 'full_body'] as const;
export const MODEL_RULE_POSES = MODEL_POSE_RECIPES.filter(p => !['portrait', 'footwear_closeup'].includes(p.promptProfile.category)
  && !['profile_left', 'profile_right'].includes(p.promptProfile.orientation));

export function defaultModelMarketplaceRule(channel: MarketplaceId): ModelMarketplaceRule {
  const appearance: ModelMarketplaceAppearance = { background: 'client', framing: 'auto', face: 'auto', lookingAtCamera: true, standingFront: false };
  return { aspectRatio: channel === 'tiktok-shop' ? '1:1' : 'client', shots: [...MODEL_RULE_SHOTS], allowedPoseRecipeIds: [],
    main: { ...appearance, standingFront: channel === 'amazon' }, alternative: { ...appearance },
    validation: { garmentVisible: true, noAccessories: true, pureWhite: true } };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const oneOf = (v: unknown, options: readonly unknown[]) => options.includes(v);
const list = (v: unknown, options: readonly unknown[]) => Array.isArray(v) && v.length <= options.length && new Set(v).size === v.length && v.every(x => options.includes(x));
export function validateModelMarketplaceRule(value: unknown): ModelMarketplaceRule {
  const invalid = () => { throw new Error('Reglas inválidas. Revisa formato, poses, encuadre, rostro y validación.'); };
  if (!exact(value, ['aspectRatio', 'shots', 'allowedPoseRecipeIds', 'main', 'alternative', 'validation'])) return invalid();
  if (!oneOf(value.aspectRatio, MODEL_RULE_RATIOS) || !list(value.shots, MODEL_RULE_SHOTS) || !(value.shots as string[]).includes('front')
    || !list(value.allowedPoseRecipeIds, MODEL_RULE_POSES.map(p => p.id))) return invalid();
  for (const appearance of [value.main, value.alternative]) {
    if (!exact(appearance, ['background', 'framing', 'face', 'lookingAtCamera', 'standingFront'])
      || !oneOf(appearance.background, ['client', 'white', 'neutral']) || !oneOf(appearance.framing, MODEL_RULE_FRAMINGS)
      || !oneOf(appearance.face, ['auto', 'visible', 'hidden']) || typeof appearance.lookingAtCamera !== 'boolean' || typeof appearance.standingFront !== 'boolean'
      || appearance.face === 'hidden' && appearance.framing !== 'lower_body'
      || appearance.face === 'visible' && appearance.framing === 'lower_body') return invalid();
  }
  if (!exact(value.validation, ['garmentVisible', 'noAccessories', 'pureWhite']) || !Object.values(value.validation).every(v => typeof v === 'boolean')) return invalid();
  return structuredClone(value) as unknown as ModelMarketplaceRule;
}
export function effectiveModelMarketplaceRule(channel: MarketplaceId, rules?: ModelMarketplaceRules) {
  return rules?.[channel] ?? defaultModelMarketplaceRule(channel);
}

/** Saved selections only: missing rules never imply selecting the whole catalogue. */
export function selectedModelMarketplacePoses(channels: readonly MarketplaceId[], rules: ModelMarketplaceRules): string[] {
  const selected = new Set(channels.flatMap(channel => rules[channel]?.allowedPoseRecipeIds ?? []));
  return MODEL_RULE_POSES.filter(pose => selected.has(pose.id)).map(pose => pose.id);
}
