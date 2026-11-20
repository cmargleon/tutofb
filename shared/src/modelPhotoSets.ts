import { modelBackground, MODEL_BACKGROUNDS, MODEL_BASE_BACKGROUND_REPLACEMENT } from './modelBackgrounds';
import { effectiveModelMarketplaceRule } from './modelMarketplaceRules';
import type { ModelMarketplaceRules } from './types/modelMarketplaceRules';
import { MODEL_POSE_RECIPES_BY_ID, type PoseRecipe } from './modelPoseRecipes';
import { seedTryOnPrompt } from './approvedTryOnPrompt';
import { DEFAULT_TRY_ON_PROMPT } from './domain';
import type { AspectRatio, Model, ModelBaseApproval, ModelBaseOperation, ModelBaseSpec, ModelSetShot, PhotoBase, PhotoBaseObservation, PhotoPlanInput, PhotoRecipeCategory } from './types';
import type { MarketplaceId } from './marketplaces';
import { effectivePhotoRecipe, photoRecipeAllowsAppearance } from './marketplacePhotoRecipe';
import { createCommercialProviderImageConfig } from './commercialPhoto';

export const MODEL_SET_VERSION = 'model-marketplace-set-v1' as const;
export const MODEL_BASE_MAX_ATTEMPTS = 3;
/** A technical error that left no image can be resumed by the operator; it never counts against the visual-attempt cap. */
export const modelBaseResumable = (op: Pick<ModelBaseOperation, 'status' | 'attempts'>) =>
  (op.status === 'failed' || op.status === 'needs_attention') && !op.attempts.at(-1)?.poseId && op.attempts.filter(a => a.poseId).length < MODEL_BASE_MAX_ATTEMPTS;
export const MODEL_SET_SHOTS: ModelSetShot[] = ['front', 'front_three_quarter', 'commercial_back'];
export const MODEL_SET_SHOT_LABELS: Record<ModelSetShot, string> = {
  front: 'Frontal', front_three_quarter: 'Tres cuartos frontal', commercial_back: 'Espalda comercial',
};
/** Base clothing is a placeholder replaced at dressing time; it must never suggest a garment length or silhouette. */
export const MODEL_BASE_FILLER_OUTFIT = 'Placeholder clothing only, chosen so it never conditions the garment dressed later: a plain fitted opaque crew-neck T-shirt in one solid neutral color and plain fitted opaque full-length leggings in one solid neutral color that cover the legs completely and visibly reach the ankles. Both pieces are simple, tight-fitting and unlayered, with no prints, logos or accessories.';
export const MODEL_BASE_FILLER_VERIFICATION = 'Ropa de relleno requerida en la base: camiseta lisa, ajustada y opaca de un color neutro liso, y prenda inferior lisa, ajustada y opaca hasta el tobillo (tipo leggings) de un color neutro liso. fillerOutfitCompliant=true solo si toda la ropa visible en el encuadre cumple. Con encuadre lower_body o full_body la prenda inferior debe llegar visiblemente hasta los tobillos: short, bermuda, falda, vestido, pantalón cortado, remangado, ancho o suelto es false. Con upper_body evalúa la camiseta y, si se ven los muslos, también la prenda inferior (un short visible es false). Estampados, logos, capas o accesorios en la ropa son false. Explica fillerOutfitEvidence con lo que se ve.';
export const MODEL_BASE_FILLER_ISSUE = 'Ropa de relleno no válida: se requiere camiseta lisa ajustada y prenda inferior lisa ajustada hasta el tobillo, nunca short.';
export const MODEL_SET_POSE_INSTRUCTIONS: Record<ModelSetShot, string> = {
  front: 'True frontal standing pose, shoulders and hips facing the camera. Arms relaxed at sides, eyes open and mouth closed when the face is visible.',
  front_three_quarter: 'Natural commercial three-quarter front turn, showing volume and part of the side. Never a rigid 90-degree profile.',
  commercial_back: 'The rear of the garment is the protagonist. Keep the back fully readable, with a natural slight body turn; when the face is in frame look at the camera over the shoulder. Arms and hair must not hide garment details.',
};
export function photoTaskConfig(input: Pick<PhotoPlanInput, 'provider' | 'imageConfig' | 'aspectRatio'>, channel: MarketplaceId, rules?: ModelMarketplaceRules) {
  const configured = rules?.[channel]?.aspectRatio;
  if (configured && configured !== 'client') return photoConfigForRatio(input, configured);
  if (configured === 'client' || channel !== 'tiktok-shop') return { imageConfig: input.imageConfig, aspectRatio: input.aspectRatio };
  return photoConfigForRatio(input, '1:1');
}
export function photoConfigForRatio(input: Pick<PhotoPlanInput, 'provider' | 'imageConfig'>, aspectRatio: AspectRatio) {
  const sizing = createCommercialProviderImageConfig(input.provider, aspectRatio);
  const imageConfig = { ...input.imageConfig };
  for (const key of ['imageSize', 'aspectRatio', 'size'] as const) {
    if (key in sizing) Object.assign(imageConfig, { [key]: sizing[key as keyof typeof sizing] });
  }
  return { imageConfig, aspectRatio };
}
export function modelBaseSpec(channel: MarketplaceId, category: PhotoRecipeCategory, audience: ModelBaseSpec['audience'], bodyArea: ModelBaseSpec['bodyArea'], shot: ModelSetShot,
  marketplaces: PhotoPlanInput['marketplaces'], ratio: AspectRatio = '3:4', rules?: ModelMarketplaceRules): ModelBaseSpec {
  const main = shot === 'front';
  const field = main ? 'mainBackground' : 'additionalBackground';
  const { preferences } = effectivePhotoRecipe(marketplaces?.[channel]?.photoRecipe, category);
  const defaultBackground = main && (channel === 'amazon' || channel === 'tiktok-shop') ? 'white' : 'neutral';
  const background = photoRecipeAllowsAppearance(channel, field, category, audience, false, false) ? preferences[field] ?? defaultBackground : defaultBackground;
  const spec: ModelBaseSpec = { version: MODEL_SET_VERSION, channel, category, audience, bodyArea, shot, role: main ? 'main' : 'alternative', background,
    aspectRatio: channel === 'tiktok-shop' ? '1:1' : ratio,
    framing: bodyArea === 'lower_body' || bodyArea === 'footwear' ? 'lower_body' : bodyArea === 'full_body' ? 'full_body' : 'upper_body',
    faceVisible: bodyArea !== 'lower_body' && bodyArea !== 'footwear' };
  return applyModelMarketplaceRule(spec, ratio, rules);
}
export function applyModelMarketplaceRule(spec: ModelBaseSpec, ratio: AspectRatio, rules?: ModelMarketplaceRules): ModelBaseSpec {
  const rule = rules?.[spec.channel];
  if (!rule) return spec;
  const appearance = rule[spec.role === 'main' ? 'main' : 'alternative'];
  const framing = appearance.framing === 'auto' ? spec.framing : appearance.framing;
  const { backgroundTone: _previousTone, ...baseSpec } = spec;
  return { ...baseSpec, ...(appearance.background === 'neutral' && appearance.backgroundTone ? { backgroundTone: appearance.backgroundTone } : {}), rulesRevision: rule.revision, aspectRatio: rule.aspectRatio === 'client' ? ratio : rule.aspectRatio,
    background: appearance.background === 'client' ? spec.background : appearance.background, framing,
    faceVisible: appearance.face === 'auto' ? framing !== 'lower_body' : appearance.face === 'visible',
    lookingAtCamera: appearance.lookingAtCamera, standingFront: appearance.standingFront, validation: { ...rule.validation } };
}
export const sameBaseSpec = (a: ModelBaseSpec, b: ModelBaseSpec): boolean =>
  a?.backgroundTone === b.backgroundTone && (Object.keys(b) as Array<keyof ModelBaseSpec>).every(key => key === 'validation'
    ? !!a?.validation && !!b.validation && (Object.keys(b.validation) as Array<keyof NonNullable<ModelBaseSpec['validation']>>).every(field => a.validation?.[field] === b.validation?.[field]) : a?.[key] === b[key]);
/**
 * `requireFillerOutfit` is set by the verifier for new approvals. Stored approvals verified before the filler check
 * (field absent) stay valid; an explicit false is always rejected.
 */
export function baseObservationIssues(spec: ModelBaseSpec, o?: PhotoBaseObservation, options: { requireFillerOutfit?: boolean } = {}): string[] {
  if (!o?.verified) return ['Observación visual incierta o pendiente.'];
  const [w, h] = spec.aspectRatio.split(':').map(Number);
  return [
    spec.poseRecipeId && o.concretePoseMatches !== true ? 'La pose concreta seleccionada no está verificada.' : '',
    o.pose !== spec.shot ? `Pose requerida: ${MODEL_SET_SHOT_LABELS[spec.shot]}.` : '',
    o.framing !== spec.framing ? `Encuadre requerido: ${spec.framing}.` : '',
    o.background !== spec.background || spec.backgroundTone && (o.backgroundTone !== spec.backgroundTone || o.backgroundMatches !== true || !o.backgroundEvidence?.trim())
      ? `Fondo requerido: ${modelBackground(spec).label.toLowerCase()}; observado: ${o.background === 'white' ? 'blanco' : o.backgroundTone && o.backgroundTone in MODEL_BACKGROUNDS ? MODEL_BACKGROUNDS[o.backgroundTone as keyof typeof MODEL_BACKGROUNDS].label.toLowerCase() : o.backgroundTone || o.background}.` : '',
    spec.background === 'white' && spec.validation?.pureWhite !== false && o.whiteRgbVerified !== true ? 'El blanco puro no supera la comprobación técnica del perímetro.' : '',
    !o.width || !o.height || Math.abs(o.width / o.height - w / h) > .002 ? `Proporción requerida: ${spec.aspectRatio}, sin recortar la prenda.` : '',
    (options.requireFillerOutfit ? o.fillerOutfitCompliant !== true : o.fillerOutfitCompliant === false) ? MODEL_BASE_FILLER_ISSUE : '',
    (spec.validation?.garmentVisible !== false && !o.garmentVisible) || (spec.validation?.noAccessories !== false && o.accessories) ? 'La zona de la prenda debe estar completa, sin ocultaciones ni accesorios ajenos.' : '',
    o.faceVisible !== spec.faceVisible ? 'Visibilidad del rostro incompatible con el encuadre.' : '',
    spec.faceVisible && spec.lookingAtCamera !== false && !o.lookingAtCamera ? 'El rostro visible debe mirar hacia cámara.' : '',
    o.audience !== spec.audience ? 'Edad/público incompatible.' : '',
    !o.identityCoherent ? 'Identidad, edad o proporciones no coinciden con la identidad aprobada.' : '',
    (spec.standingFront ?? (spec.channel === 'amazon' && spec.role === 'main')) && (o.posture !== 'standing' || !o.mainPoseCompliant) ? 'Se requiere frontal de pie, ojos abiertos, boca cerrada y brazos a los lados.' : '',
    o.performer === 'unknown' ? 'Confirma la procedencia real o sintética de la identidad.' : '',
  ].filter(Boolean);
}
export const compatibleBaseApproval = (base: PhotoBase, spec: ModelBaseSpec): ModelBaseApproval | undefined =>
  base.approvals?.find(a => !a.requiresReverification && a.poseId === base.id && a.storagePath === base.storagePath
    && a.verifierVersion === 'model-base-verifier-v1' && sameBaseSpec(a.spec, spec) && baseObservationIssues(spec, a.observation).length === 0);

/** Shared by catalogue, wizard and automation; legacy labels alone never confer approval. */
export function modelPhotoBases(model?: Model | null, poseIds?: string[]): PhotoBase[] {
  const identity = model?.approvedIdentity;
  const identityCurrent = identity && ['sex', 'age', 'skin', 'hairColor', 'hairLength', 'build'].every(field =>
    (identity.traitsSnapshot?.[field as keyof NonNullable<Model['identityTraits']>] ?? null) === (model?.identityTraits?.[field as keyof NonNullable<Model['identityTraits']>] ?? null));
  return (model?.poses || []).filter(p => p.active !== false && (!poseIds || poseIds.includes(p.id))).map(p => ({ id: p.id, storagePath: p.storagePath,
    ...(p.photoObservation ? { observation: p.photoObservation } : {}),
    approvals: (model?.marketplaceBaseApprovals || []).filter(a => identityCurrent && a.clientId === model?.clientId && (!model?.id || a.modelId === model.id) && a.poseId === p.id && a.identitySha256 === identity.sha256),
  }));
}
export function buildModelBasePrompt(spec: ModelBaseSpec): string {
  const concrete = spec.poseRecipeId ? MODEL_POSE_RECIPES_BY_ID.get(spec.poseRecipeId) : undefined;
  const framing = spec.bodyArea === 'footwear' && spec.framing === 'lower_body' ? 'Footwear crop, both shoes completely visible.'
    : spec.framing === 'upper_body' ? 'Frame from thighs to above the head, entire upper garment visible.'
    : spec.framing === 'lower_body' ? 'Frame from chest to below both feet. No face or head in frame; waistband and hems fully visible.'
    : 'Full body from above the head to below both feet; show the complete outfit with free margins.';
  const configured = spec.rulesRevision !== undefined;
  const poseInstructions = spec.shot === 'commercial_back' && spec.lookingAtCamera === false
    ? MODEL_SET_POSE_INSTRUCTIONS[spec.shot].replace('when the face is in frame look at the camera over the shoulder.', 'allow a natural gaze when the face appears.')
    : MODEL_SET_POSE_INSTRUCTIONS[spec.shot];
  return `Create a commercial model base from the approved identity reference. Preserve the exact person, age, skin, build and body proportions. ${MODEL_BASE_BACKGROUND_REPLACEMENT} ${MODEL_BASE_FILLER_OUTFIT} ${poseInstructions} ${concrete ? `Concrete pose: ${concrete.shotType}. ${(concrete.promptDirectives || []).join(' ')}` : ''} ${configured ? 'The following configured framing and gaze take precedence over crop and gaze wording in the pose recipe.' : ''} ${framing} ${spec.faceVisible ? `Keep the face visible.${spec.lookingAtCamera !== false ? ' Look at the camera.' : ' Natural gaze; looking at camera is optional.'}` : 'Gaze instructions do not apply; keep the face outside the crop.'} Configured background for ${spec.channel} / ${spec.role}: ${modelBackground(spec).prompt} Compose natively at ${spec.aspectRatio}; never crop off the clothing to obtain the ratio. Clear even lighting. ${spec.validation?.garmentVisible !== false ? 'No occlusion by arms or hair; the garment area must be fully visible.' : ''} ${(spec.standingFront ?? (spec.channel === 'amazon' && spec.role === 'main')) ? 'Standing frontal, eyes open, mouth closed and arms at sides.' : ''}`;
}

/** Composition changes belong to recipes, never to optional dressing instructions. */
export function photoPromptConflicts(prompt = ''): string[] {
  const checks = [
    [/\b(strict (?:side |left |right )?profile|perfil (?:estricto|rígido)|(?:turn|gira\w*)[^.\n]{0,30}90\s*(?:degrees|grados|°))\b/i, 'perfil estricto a 90°'],
    [/\b(?:do not|never|sin|no)\s+(?:look(?:ing)? (?:back )?(?:at|toward)|mir(?:ar|ando|e[sn]?) (?:hacia )?(?:la )?c[aá]mara)/i, 'prohibición de mirar hacia cámara'],
    [/(?:change|replace|adapt|cambia\w*|sustitu\w*|adapta\w*) (?:the |el )?(?:background|fondo|pose|encuadre|camera|c[aá]mara)/i, 'cambio de composición de la base'],
    [/\b(?:no|never|do not) (?:square|cuadrad[oa]|convert to square)\b/i, 'prohibición de formato cuadrado'],
  ] as const;
  const affirmative = prompt.replace(/(?:do not|never|no) (?:change|replace|adapt|cambies|sustituyas|adaptes)[^.!?\n]*/gi, '');
  return checks.filter(([pattern]) => pattern.test(affirmative)).map(([, message]) => message);
}

export function marketplaceDressingCustomization(prompt = ''): string {
  return [DEFAULT_TRY_ON_PROMPT.trim(), seedTryOnPrompt(DEFAULT_TRY_ON_PROMPT).general.trim()].includes(prompt.trim()) ? '' : prompt.trim();
}

export function selectedPhotoMarketplaces(marketplaces: PhotoPlanInput['marketplaces'], selected?: MarketplaceId[]) {
  if (selected && (!selected.length || new Set(selected).size !== selected.length || selected.some(channel => marketplaces?.[channel]?.enabled !== true)))
    throw new Error('Selecciona un subconjunto de los marketplaces activos del cliente.');
  return selected ? Object.fromEntries(selected.map(channel => [channel, marketplaces![channel]!])) : marketplaces || {};
}

/** Concrete poses remain distinct even when they share their commercial orientation. */
export function concreteModelBaseSpec(recipe: PoseRecipe, channel: MarketplaceId, category: PhotoRecipeCategory,
  audience: ModelBaseSpec['audience'], marketplaces: PhotoPlanInput['marketplaces'], ratio: AspectRatio, rules?: ModelMarketplaceRules): { spec?: ModelBaseSpec; reason?: string } {
  const { category: framing, orientation } = recipe.promptProfile;
  if (framing === 'portrait' || framing === 'footwear_closeup') return { reason: 'El encuadre cerrado no cubre la zona completa exigida por las recetas de vestido actuales.' };
  if (orientation === 'profile_left' || orientation === 'profile_right') return { reason: 'El perfil rígido no es una base comercial de tres cuartos frontal.' };
  const child = audience !== 'adult';
  if (child && (channel === 'tiktok-shop' || ['bodysuit', 'fitted_child', 'underwear', 'swimwear'].includes(category)) || audience === 'baby' && channel === 'mercado-libre')
    return { reason: 'Esta categoría y público se presentan sin modelo en este destino.' };
  const rule = effectiveModelMarketplaceRule(channel, rules);
  if (rules?.[channel] && !rule.allowedPoseRecipeIds.includes(recipe.id)) return { reason: 'Pose deshabilitada en Reglas Marketplace.' };
  const shot: ModelSetShot = orientation.startsWith('back') ? 'commercial_back' : orientation === 'front' ? 'front' : 'front_three_quarter';
  if (!rule.shots.includes(shot)) return { reason: 'Vista deshabilitada en Reglas Marketplace.' };
  const role = ['full-front', 'half-front', 'lower-front'].includes(recipe.id) ? 'main' : 'alternative';
  const { preferences } = effectivePhotoRecipe(marketplaces?.[channel]?.photoRecipe, category);
  if ((role === 'main' ? preferences.mainComposition : preferences.additionalComposition) === 'flat_lay') return { reason: 'La receta del destino requiere presentación sin modelo para esta función.' };
  if (shot !== 'front' && !preferences.views.includes(shot === 'commercial_back' ? 'back' : 'side')) return { reason: 'Esta vista está desactivada en la receta del cliente.' };
  const bodyArea = framing === 'full_body' ? 'full_body' : framing === 'lower_body' ? 'lower_body' : 'upper_body';
  const spec = modelBaseSpec(channel, category, audience, bodyArea, shot, marketplaces, ratio);
  if (role === 'alternative' && spec.role === 'main') {
    spec.background = preferences.additionalBackground ?? 'neutral';
  }
  return { spec: applyModelMarketplaceRule({ ...spec, role, poseRecipeId: recipe.id }, ratio, rules) };
}
