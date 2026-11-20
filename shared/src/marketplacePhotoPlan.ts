import { MODEL_DRESSING_BACKGROUND, modelBackground } from './modelBackgrounds';
import { effectiveModelMarketplaceRule } from './modelMarketplaceRules';
import type { PhotoArticle, PhotoAttribute, PhotoPlan, PhotoPlanInput, PhotoRequirement, PhotoTask } from './types/photoPlan';
import { compatibleBaseApproval, modelBaseSpec, photoTaskConfig, photoPromptConflicts, marketplaceDressingCustomization } from './modelPhotoSets';
import type { MarketplaceId } from './marketplaces';
import { getProviderCostUsd } from './constants/providerCosts';
import { effectivePhotoRecipe, photoRecipeAllowsAppearance, photoRecipeRevisions, PHOTO_RECIPE_VERSION } from './marketplacePhotoRecipe';

export const PHOTO_PLAN_VERSION = 'marketplace-photo-v1' as const;
export const PHOTO_CHANNELS: MarketplaceId[] = ['amazon', 'mercado-libre', 'tiktok-shop', 'shein'];
export const activePhotoChannels = (marketplaces: PhotoPlanInput['marketplaces']) => PHOTO_CHANNELS.filter(id => marketplaces?.[id]?.enabled === true);
export const canonicalPhotoJson = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
// A compact deterministic identifier; the server additionally compares the full frozen input.
export function photoIdentity(value: unknown): string {
  const json = canonicalPhotoJson(value); let a = 2166136261; let b = 2246822519;
  for (let i = 0; i < json.length; i++) { a = Math.imul(a ^ json.charCodeAt(i), 16777619); b = Math.imul(b ^ json.charCodeAt(i), 3266489917); }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
export const knownPhotoAttribute = <T>(attribute?: PhotoAttribute<T>): T | null => attribute && (attribute.source !== 'gemini' || (attribute.confidence ?? 0) >= .8) ? attribute.value : null;
export const manualPhotoAttribute = <T>(value: T | null, evidence = 'Corrección del operador'): PhotoAttribute<T> => ({ value, confidence: 1, evidence, source: 'manual' });
export const COMMON_PHOTO_INSTRUCTIONS = 'Representa fielmente la variante, color real, corte, textura, estampados, logos exteriores, cantidades y componentes vendidos. No inventes materiales, detalles ocultos ni colores sin referencias. No añadas productos que confundan, textos, logos añadidos, promociones, precios, contactos, QR, bordes ni marcas de agua. Conserva los logos reales del producto. Respeta derechos y restricciones de contenido. Color, sin blanco y negro exclusivo. Cobertura apropiada, sin exposición íntima, sexualización ni barras gráficas; conserva transparencias fieles.';
const rule = (id: string, channel: PhotoRequirement['channel'], category: string, imageType: PhotoRequirement['imageType'], level: PhotoRequirement['level'], text: string): PhotoRequirement => ({ id, channel, category, imageType, level, text, verified: level !== 'preference', source: level === 'preference' ? 'tuto-product-decision' : 'supplied-marketplace-guide' });
export const PHOTO_RULES: PhotoRequirement[] = [
  rule('fidelity', 'common', 'all', 'all', 'obligation', COMMON_PHOTO_INSTRUCTIONS),
  rule('amazon-main', 'amazon', 'adult-ordinary-clothing', 'main', 'obligation', 'Modelo adulto de pie, frontal, prenda completa sobre RGB 255,255,255, aproximadamente 85% según guía aplicable. Ojos abiertos, boca cerrada, brazos a los lados. No sentado, arrodillado, inclinado, recostado, maniquí visible, perchas, prendas dobladas, selfie, collage ni colores adicionales salvo pack real.'),
  rule('amazon-pack', 'amazon', 'packs', 'main', 'obligation', 'Presentación plana sin modelo, contenido exacto del pack.'),
  rule('amazon-child-fitted', 'amazon', 'child-underwear-swimwear-bodysuits', 'main', 'obligation', 'Prenda infantil ajustada, body, interior o baño: sin modelo, superficie plana. Esta excepción no comprende toda ropa infantil.'),
  rule('amazon-sensitive', 'amazon', 'adult-underwear-swimwear', 'main', 'obligation', 'Portada frontal, cobertura apropiada, sin sexualización ni exposición íntima en transparencias.'),
  rule('amazon-xmp', 'amazon', 'synthetic-performer', 'all', 'obligation', 'Personas fotorrealistas íntegramente generadas por IA: contains-synthetic-performer en dc:subject XMP del archivo final. Retoque de persona real no lo requiere.'),
  rule('ml-main', 'mercado-libre', 'single-clothing', 'main', 'recommendation', 'Favorecer fondo real neutro claro o contexto/textura discreta y sombras naturales. Modelo o maniquí completamente invisible según categoría. Prenda completa, centrada, sin tocar bordes, arrugas, perchas, doblado ni selfies; no más de una persona ni accesorios que confundan. Superior: muslos a encima de cabeza; inferior: pecho a debajo de pies; prendas completas según longitud.'),
  rule('ml-pack', 'mercado-libre', 'packs', 'main', 'obligation', 'Fondo digitalizado blanco, gris claro o crema, sin textura ni degradado. Disposición ordenada y contenido exacto.'),
  rule('ml-baby', 'mercado-libre', 'baby', 'main', 'recommendation', 'Favorecer prenda sola completa sin doblar ni colgar.'),
  rule('ml-sensitive', 'mercado-libre', 'underwear-swimwear-unisex', 'all', 'recommendation', 'Modelo o maniquí invisible, prenda completa sin sexualización. Maniquí invisible unisex sin silueta marcadamente de un género.'),
  rule('tiktok-main', 'tiktok-shop', 'all', 'main', 'obligation', 'Portada frontal sobre blanco puro.'),
  rule('tiktok-set-square', 'tiktok-shop', 'all', 'all', 'preference', 'Preferencia de producto Tuto para este flujo: composición nativa 1:1, sin recortar la prenda. No es una obligación universal de TikTok.'),
  rule('tiktok-child', 'tiktok-shop', 'all-child-clothing', 'all', 'obligation', 'Toda ropa bebé/infantil: flat lay blanco, sin personas ni maniquíes en ninguna imagen.'),
  rule('tiktok-underwear', 'tiktok-shop', 'adult-underwear', 'all', 'obligation', 'Modelo de catálogo neutro, maniquí o flat lay sin exposición íntima ni poses sexualizadas.'),
  rule('shein-schema', 'shein', 'configured-skc-schema', 'main', 'obligation', 'Principal SKC por color: image_type=1, image_sort=1. No repetir portada como detalle SKC. Otros tipos solo con esquema configurado.'),
  rule('shein-context', 'shein', 'all', 'main', 'preference', 'Preferencia comercial por contexto discreto; no es obligación de fondo, pose o modelo ni afirmación de conversión. Se permiten niños modelando ropa apropiada.'),
];

export function buildMarketplacePhotoPlan(input: PhotoPlanInput): PhotoPlan {
  const active = activePhotoChannels(input.marketplaces);
  const channels = input.articles.some(a => a.kind === 'garment') ? active.filter(channel => !input.selectedChannels || input.selectedChannels.includes(channel)) : [];
  const plan: PhotoPlan = { version: PHOTO_PLAN_VERSION, id: '', clientId: input.clientId, channels, articles: input.articles,
    rules: channels.length ? PHOTO_RULES.filter(r => r.channel === 'common' || channels.includes(r.channel as MarketplaceId)) : [], tasks: [], issues: [],
    effectiveConfig: { provider: input.provider, imageConfig: input.imageConfig, aspectRatio: input.aspectRatio },
    estimate: { uniqueImages: 0, generations: 0, reviews: 0, estimatedCostUsd: 0 } };
  const issue = (itemId: string, code: string, message: string, blocking = true) => plan.issues.push({ itemId, code, message, blocking });
  if (input.selectedChannels && (!input.selectedChannels.length || input.selectedChannels.some(c => !active.includes(c)))) issue('', 'destinations', 'Selecciona al menos un marketplace activo del cliente.');
  if (marketplaceDressingCustomization(input.customPrompt).length > 2000) issue('', 'prompt-length', 'Reduce la personalización a instrucciones breves de vestido (máximo 2000 caracteres). Las reglas de composición ya están en la receta.');
  for (const conflict of photoPromptConflicts(marketplaceDressingCustomization(input.customPrompt))) issue('', 'prompt-conflict', `Personalización incompatible: ${conflict}. Corrige el prompt para conservar la base aprobada.`);
  const recipeSnapshot: NonNullable<PhotoPlan['recipeSnapshot']> = {
    version: PHOTO_RECIPE_VERSION, channels: photoRecipeRevisions(channels, input.marketplaces), articles: [],
  };
  const hasRecipes = channels.some(channel => input.marketplaces?.[channel]?.photoRecipe);
  for (const article of input.articles.filter(a => a.kind === 'garment').sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    if (!channels.length) break;
    const a = article.attributes;
    const category = knownPhotoAttribute(a.category), audience = knownPhotoAttribute(a.audience), packaging = knownPhotoAttribute(a.packaging);
    const area = knownPhotoAttribute(a.bodyArea);
    const recipeCategory = category === 'object' ? null : category;
    const selections = channels.map(channel => ({ channel, ...effectivePhotoRecipe(input.marketplaces?.[channel]?.photoRecipe, recipeCategory) }));
    recipeSnapshot.articles.push({ itemId: article.itemId, category: recipeCategory, channels: selections });
    const startingIssues = plan.issues.length;
    if (!article.references.length || !article.references.some(r => r.view === 'front')) issue(article.itemId, 'front-reference', 'Falta referencia frontal fiel de esta variante.');
    if (article.kind === 'garment') {
      for (const [key, value] of Object.entries({ category, audience, packaging, bodyArea: area, transparency: knownPhotoAttribute(a.transparency), color: knownPhotoAttribute(a.color), components: knownPhotoAttribute(a.components) }))
        if (value === null || value === '') issue(article.itemId, `attribute-${key}`, `Confirma ${key}: atributo indispensable desconocido; se conservan las referencias.`);
    }
    if (plan.issues.length > startingIssues) continue;
    const child = audience === 'child' || audience === 'baby';
    const pack = packaging === 'multipack' || packaging === 'set';
    const sensitiveChild = child && (category === 'underwear' || category === 'swimwear' || category === 'bodysuit' || category === 'fitted_child');
    const hasReference = (view: PhotoTask['view']) => article.references.some(r => r.view === view);
    const restrictedDetail = (channel: MarketplaceId) => child && channel === 'tiktok-shop';
    for (const { channel, preferences } of selections) {
      if (preferences.missingReference !== 'review') continue;
      for (const view of preferences.views) {
        if (!hasReference(view) || (view === 'detail' && restrictedDetail(channel)))
          issue(article.itemId, `recipe-reference-${view}-${channel}`, `${channel}: la receta solicita revisión. Falta evidencia utilizable para ${view === 'back' ? 'espalda' : view === 'side' ? 'lateral' : 'detalle'}.`);
      }
    }
    // Hold this article for review before adding any destinations or reserving generations.
    if (plan.issues.length > startingIssues) continue;
    const positions = new Map<MarketplaceId, number>();
    const add = (channel: MarketplaceId, view: PhotoTask['view'], background: PhotoTask['background'], flat: boolean, main: boolean, recipeSources?: PhotoTask['destinations'][number]['recipeSources'], scene?: { type: string; prompt: string }) => {
      const composition: PhotoTask['composition'] = view === 'detail' ? 'reference' : article.kind === 'product' ? 'product' : flat ? 'flat_lay' : 'model';
      const refs = article.references.filter(r => r.view === view).map(r => r.storagePath).sort();
      if (!refs.length) return;
      const outputPose = view === 'back' ? 'commercial_back' as const : view === 'side' ? 'front_three_quarter' as const : 'front' as const;
      const taskConfig = photoTaskConfig(input, channel, composition === 'model' ? input.modelMarketplaceRules : undefined);
      const spec = composition === 'model' ? modelBaseSpec(channel, recipeCategory!, audience!, area!, outputPose, input.marketplaces, input.aspectRatio, input.modelMarketplaceRules) : null;
      if (spec) {
        if (!effectiveModelMarketplaceRule(channel, input.modelMarketplaceRules).shots.includes(outputPose)) return;
        background = spec.background;
      }
      // A lateral garment reference is evidence, never a command to turn the person 90 degrees.
      if (view === 'side' && composition === 'model') refs.push(...article.references.filter(r => r.view === 'front').map(r => r.storagePath).filter(path => !refs.includes(path)));
      const candidate = spec ? (input.bases || []).find(b => (!article.modelId || b.approvals?.some(a => a.modelId === article.modelId)) && compatibleBaseApproval(b, spec)) || null : null;
      const approval = candidate && compatibleBaseApproval(candidate, spec!);
      const base = candidate && approval ? { id: candidate.id, storagePath: candidate.storagePath, observation: approval.observation, approvals: [approval] } : null;
      if (spec && !base) {
        issue(article.itemId, `base-${channel}-${view}`, `${channel}: falta base aprobada ${outputPose}, categoría ${recipeCategory}, ${audience}, zona ${area}, fondo ${background}, ${taskConfig.aspectRatio}. Completa o verifica esta toma en el catálogo del modelo.`);
        return;
      }
      const identityBase = null;
      const syntheticPerformer = base ? compatibleBaseApproval(base, spec!)!.observation.performer === 'synthetic' : false;
      const ruleIds = ['fidelity'];
      if (channel === 'amazon' && article.kind === 'garment' && main) {
        if (pack) ruleIds.push('amazon-pack');
        else if (sensitiveChild) ruleIds.push('amazon-child-fitted');
        else if (audience === 'adult' && category === 'ordinary') ruleIds.push('amazon-main');
        else if (audience === 'adult' && ['underwear', 'swimwear'].includes(category!)) ruleIds.push('amazon-sensitive');
      }
      if (channel === 'amazon' && syntheticPerformer) ruleIds.push('amazon-xmp');
      if (channel === 'tiktok-shop') { if (main) ruleIds.push('tiktok-main'); ruleIds.push('tiktok-set-square'); if (child && article.kind === 'garment') ruleIds.push('tiktok-child'); if (category === 'underwear' && !child) ruleIds.push('tiktok-underwear'); }
      if (channel === 'mercado-libre' && article.kind === 'garment') ruleIds.push(pack ? 'ml-pack' : audience === 'baby' ? 'ml-baby' : 'ml-main');
      if (channel === 'shein') ruleIds.push(...(main ? ['shein-schema', 'shein-context'] : []));
      const position = (positions.get(channel) || 0) + 1; positions.set(channel, position);
      // One photo per marketplace: each destination is generated and validated against its own channel rules only.
      // Within a channel, identical evidence, variant and composition still collapse into one task.
      const key = { channel, outputPose, taskConfig, itemId: article.itemId, productId: article.productId, variantId: article.variantId, refs: article.references.filter(r => refs.includes(r.storagePath)), view, attributes: article.attributes, background, composition, area, base: base ? { id: base.id, storagePath: base.storagePath, sha256: compatibleBaseApproval(base, spec!)!.sha256 } : null, scene: scene || null, config: taskConfig };
      const id = photoIdentity(key);
      let task = plan.tasks.find(t => t.id === id);
      if (!task) {
        const instructions = composition === 'model'
          ? `Dress the person in the FIRST image using only the supplied garment references. Preserve the exact person, age, proportions, pose, gaze, camera, lighting, background and framing of the approved base. ${MODEL_DRESSING_BACKGROUND} ${spec ? modelBackground(spec).prompt : ''} Match the real color, cut, texture, logos and visible details; no invented hidden details or added accessories. ${knownPhotoAttribute(article.attributes.transparency) ? 'Preserve transparency faithfully with appropriate coverage and no intimate exposure.' : ''} The garment reference view is evidence only; never change the base pose to match it.`
          : composition === 'reference' ? 'Use only the real detail reference. Do not invent, extend or reinterpret hidden texture, color or details.'
          : `Create a flat lay of ONLY the exact sold garments/components on a ${background === 'white' ? 'pure white RGB 255,255,255' : 'quiet neutral'} surface. No person, body parts, mannequin or hanger. Preserve real quantities, color, cut, texture and logos from the references; do not invent hidden details. Show the complete garment with free margins. View: ${view}.`;
        task = { ...(background === 'white' && knownPhotoAttribute(article.attributes.transparency) === false && /^(gris|gray|grey|azul|blue|negro|black|rojo|red|verde|green|marrón|brown)$/i.test(knownPhotoAttribute(article.attributes.color) || '') ? { backgroundCorrection: 'neutral-white-perimeter' as const } : {}), ...(scene ? { sceneId: scene.type } : {}), ...(spec ? { baseSpec: spec, outputPose } : {}), ...taskConfig, id, itemId: article.itemId, productId: article.productId, variantId: article.variantId, referencePaths: refs, view, composition, background, bodyArea: area, base, identityBase, syntheticPerformer, instructions, destinations: [] };
        plan.tasks.push(task);
      }
      if (base && task.base && !task.base.approvals?.some(a => a.spec.channel === channel)) task.base.approvals?.push(...base.approvals);
      task.destinations.push({ channel, productId: article.productId, variantId: article.variantId, position, role: main ? 'main' : 'alternative', required: main, ruleIds,
        ...(recipeSources ? { recipeSources } : {}),
        ...(channel === 'shein' && main ? { imageType: 1, imageSort: 1 } : {}) });
    };
    for (const { channel, preferences, sources } of selections) {
      const flat = pack || sensitiveChild || (child && channel === 'tiktok-shop') || (audience === 'baby' && channel === 'mercado-libre');
      const addView = (view: PhotoTask['view'], defaultBackground: PhotoTask['background']) => {
        const main = view === 'front';
        const bgField = main ? 'mainBackground' : 'additionalBackground';
        const compField = main ? 'mainComposition' : 'additionalComposition';
        const canChooseBackground = view !== 'detail' && photoRecipeAllowsAppearance(channel, bgField, recipeCategory, audience, pack, flat);
        const canChooseComposition = view !== 'detail' && photoRecipeAllowsAppearance(channel, compField, recipeCategory, audience, pack, flat);
        const background = (canChooseBackground ? preferences[bgField] : undefined) ?? defaultBackground;
        const composition = canChooseComposition ? preferences[compField] : undefined;
        add(channel, view, background, composition ? composition === 'flat_lay' : flat, main, hasRecipes ? {
          background: canChooseBackground ? sources[bgField] : 'constraint',
          composition: canChooseComposition ? sources[compField] : (view === 'detail' || flat || channel === 'amazon' && main ? 'constraint' : 'default'),
        } : undefined);
      };
      addView('front', channel === 'tiktok-shop' || channel === 'amazon' || pack ? 'white' : 'neutral');
      for (const view of (sources.views === 'default' ? ['side', 'back', 'detail'] as const : preferences.views)) {
        if (hasReference(view)) {
          if (view === 'detail' && restrictedDetail(channel)) issue(article.itemId, 'tiktok-child-detail', 'TikTok infantil: el detalle real no se asigna sin evidencia de flat lay sin personas. Las otras vistas planas se conservan.', false);
          else addView(view, restrictedDetail(channel) ? 'white' : view === 'detail' ? 'original' : 'neutral');
        } else if (sources.views !== 'default' || sources.missingReference !== 'default') {
          issue(article.itemId, `optional-${view}-${channel}`, `${channel}: se omite ${view === 'back' ? 'espalda' : view === 'side' ? 'lateral' : 'detalle'} por falta de referencia.`, false);
        }
      }
      if (!hasReference('back') && sources.views === 'default' && sources.missingReference === 'default')
        issue(article.itemId, `optional-back-${channel}`, `${channel}: sin referencia de espalda; no se inventará esa vista.`, false);
      if (!hasReference('side') && sources.views === 'default' && sources.missingReference === 'default')
        issue(article.itemId, `optional-side-${channel}`, `${channel}: sin evidencia lateral suficiente; se omite tres cuartos para no inventar detalles.`, false);
    }
    if (plan.issues.some(i => i.itemId === article.itemId && i.blocking)) plan.tasks = plan.tasks.filter(t => t.itemId !== article.itemId);
  }
  plan.estimate.uniqueImages = plan.tasks.length;
  plan.estimate.generations = plan.tasks.filter(t => t.composition !== 'reference').length;
  plan.estimate.reviews = plan.tasks.length;
  plan.estimate.estimatedCostUsd = Number(plan.tasks.reduce((sum, t) => sum + (t.composition === 'reference' ? 0 : getProviderCostUsd(input.provider, t.imageConfig || input.imageConfig, t.referencePaths.length + (t.base || t.identityBase ? 1 : 0))) + .01, 0).toFixed(6));
  // Recipe/approval versions and per-task configuration invalidate stale approvals.
  plan.id = photoIdentity({ ...plan, recipeSnapshot, customPrompt: marketplaceDressingCustomization(input.customPrompt) });
  plan.recipeSnapshot = recipeSnapshot;
  return plan;
}

export function photoArticleFromGarment(garment: import('./types/garment').UploadedGarmentInput): PhotoArticle {
  return { itemId: garment.id, productId: garment.photoProductId || garment.id, variantId: garment.photoVariantId || garment.id, name: garment.name, kind: 'garment', attributes: garment.photoAttributes || {},
    references: (garment.photos || []).map(p => ({ id: p.id, storagePath: p.storagePath, view: p.isDetail ? 'detail' : p.view })) };
}
