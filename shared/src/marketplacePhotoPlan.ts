import type { PhotoArticle, PhotoAttribute, PhotoPlan, PhotoPlanInput, PhotoRequirement, PhotoTask } from './types/photoPlan';
import type { MarketplaceId } from './marketplaces';
import { getProviderCostUsd } from './constants/providerCosts';

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
export const manualPhotoAttribute = <T>(value: T, evidence = 'Corrección del operador'): PhotoAttribute<T> => ({ value, confidence: 1, evidence, source: 'manual' });
export const COMMON_PHOTO_INSTRUCTIONS = 'Representa fielmente la variante, color real, corte, textura, estampados, logos exteriores, cantidades y componentes vendidos. No inventes materiales, detalles ocultos ni colores sin referencias. No añadas productos que confundan, textos, logos añadidos, promociones, precios, contactos, QR, bordes ni marcas de agua. Conserva los logos reales del producto. Respeta derechos y restricciones de contenido. Color, sin blanco y negro exclusivo. Cobertura apropiada, sin exposición íntima, sexualización ni barras gráficas; conserva transparencias fieles.';
const rule = (id: string, channel: PhotoRequirement['channel'], category: string, imageType: PhotoRequirement['imageType'], level: PhotoRequirement['level'], text: string): PhotoRequirement => ({ id, channel, category, imageType, level, text, verified: true });
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
  rule('tiktok-main', 'tiktok-shop', 'all', 'main', 'obligation', 'Portada frontal sobre blanco puro. Proporción 3:4 o 4:3, predeterminada 3:4; no convertir a cuadrado.'),
  rule('tiktok-child', 'tiktok-shop', 'all-child-clothing', 'all', 'obligation', 'Toda ropa bebé/infantil: flat lay blanco, sin personas ni maniquíes en ninguna imagen.'),
  rule('tiktok-underwear', 'tiktok-shop', 'adult-underwear', 'all', 'obligation', 'Modelo de catálogo neutro, maniquí o flat lay sin exposición íntima ni poses sexualizadas.'),
  rule('shein-schema', 'shein', 'configured-skc-schema', 'main', 'obligation', 'Principal SKC por color: image_type=1, image_sort=1. No repetir portada como detalle SKC. Otros tipos solo con esquema configurado.'),
  rule('shein-context', 'shein', 'all', 'main', 'preference', 'Preferencia comercial por contexto discreto; no es obligación de fondo, pose o modelo ni afirmación de conversión. Se permiten niños modelando ropa apropiada.'),
];

export function buildMarketplacePhotoPlan(input: PhotoPlanInput): PhotoPlan {
  const channels = input.articles.some(a => a.kind === 'garment') ? activePhotoChannels(input.marketplaces) : [];
  const plan: PhotoPlan = { version: PHOTO_PLAN_VERSION, id: '', clientId: input.clientId, channels, articles: input.articles,
    rules: channels.length ? PHOTO_RULES.filter(r => r.channel === 'common' || channels.includes(r.channel as MarketplaceId)) : [], tasks: [], issues: [],
    effectiveConfig: { provider: input.provider, imageConfig: input.imageConfig, aspectRatio: input.aspectRatio },
    estimate: { uniqueImages: 0, generations: 0, reviews: 0, estimatedCostUsd: 0 } };
  const issue = (itemId: string, code: string, message: string, blocking = true) => plan.issues.push({ itemId, code, message, blocking });
  if (!channels.length) { plan.id = photoIdentity(plan); return plan; }
  for (const article of input.articles.filter(a => a.kind === 'garment').sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    const a = article.attributes;
    const category = knownPhotoAttribute(a.category), audience = knownPhotoAttribute(a.audience), packaging = knownPhotoAttribute(a.packaging);
    const area = knownPhotoAttribute(a.bodyArea);
    const startingIssues = plan.issues.length;
    if (!article.references.length || !article.references.some(r => r.view === 'front')) issue(article.itemId, 'front-reference', 'Falta referencia frontal fiel de esta variante.');
    if (article.kind === 'garment') {
      for (const [key, value] of Object.entries({ category, audience, packaging, bodyArea: area, transparency: knownPhotoAttribute(a.transparency), color: knownPhotoAttribute(a.color), components: knownPhotoAttribute(a.components) }))
        if (value === null || value === '') issue(article.itemId, `attribute-${key}`, `Confirma ${key}: atributo indispensable desconocido; se conservan las referencias.`);
    }
    if (channels.includes('tiktok-shop') && !['3:4', '4:3'].includes(input.aspectRatio)) issue(article.itemId, 'tiktok-ratio', 'TikTok requiere 3:4 o 4:3 en este proyecto; corrige el encuadre explícitamente.');
    if (plan.issues.length > startingIssues) continue;
    const child = audience === 'child' || audience === 'baby';
    const pack = packaging === 'multipack' || packaging === 'set';
    const sensitiveChild = child && (category === 'underwear' || category === 'swimwear' || category === 'bodysuit' || category === 'fitted_child');
    const positions = new Map<MarketplaceId, number>();
    const add = (channel: MarketplaceId, view: PhotoTask['view'], background: PhotoTask['background'], flat: boolean, main: boolean, scene?: { type: string; prompt: string }) => {
      const composition: PhotoTask['composition'] = view === 'detail' ? 'reference' : article.kind === 'product' ? 'product' : flat ? 'flat_lay' : 'model';
      const refs = article.references.filter(r => r.view === view).map(r => r.storagePath).sort();
      if (!refs.length) return;
      const base = composition === 'model' ? (input.bases || []).find(b => b.observation?.verified && b.observation.orientation === view
        && (background !== 'white' || b.observation.whiteRgbVerified === true) && b.observation.audience === audience && b.observation.framing === (area === 'upper_body' ? 'upper_body' : area === 'lower_body' ? 'lower_body' : 'full_body') && b.observation.background === background && b.observation.garmentVisible && !b.observation.accessories
        && (channel !== 'amazon' || !main || b.observation.posture === 'standing')) || null : null;
      const identityBase = composition === 'model' ? base || (input.bases || []).find(b => b.observation?.verified && b.observation.audience === audience && b.observation.orientation === view) || (input.bases || []).find(b => b.observation?.verified && b.observation.audience === audience) || null : null;
      const syntheticPerformer = (composition === 'model' && (!identityBase || identityBase.observation?.performer === 'synthetic')) || Boolean(scene?.type.startsWith('human_use'));
      if (identityBase?.observation?.performer === 'unknown' && channel === 'amazon') { issue(article.itemId, 'base-provenance', 'Confirma procedencia sintética/real de la base antes de preparar Amazon.'); return; }
      const ruleIds = ['fidelity'];
      if (channel === 'amazon' && article.kind === 'garment' && main) {
        if (pack) ruleIds.push('amazon-pack');
        else if (sensitiveChild) ruleIds.push('amazon-child-fitted');
        else if (audience === 'adult' && category === 'ordinary') ruleIds.push('amazon-main');
        else if (audience === 'adult' && ['underwear', 'swimwear'].includes(category!)) ruleIds.push('amazon-sensitive');
      }
      if (channel === 'amazon' && syntheticPerformer) ruleIds.push('amazon-xmp');
      if (channel === 'tiktok-shop') { if (main) ruleIds.push('tiktok-main'); if (child && article.kind === 'garment') ruleIds.push('tiktok-child'); if (category === 'underwear' && !child) ruleIds.push('tiktok-underwear'); }
      if (channel === 'mercado-libre' && article.kind === 'garment') ruleIds.push(pack ? 'ml-pack' : audience === 'baby' ? 'ml-baby' : 'ml-main');
      if (channel === 'shein') ruleIds.push(...(main ? ['shein-schema', 'shein-context'] : []));
      const position = (positions.get(channel) || 0) + 1; positions.set(channel, position);
      // Deduplicate only identical reference evidence, variant and requested composition. Destinations merge afterwards.
      const key = { itemId: article.itemId, productId: article.productId, variantId: article.variantId, refs: article.references.filter(r => refs.includes(r.storagePath)), view, attributes: article.attributes, background, composition, area, base, identityBase, scene: scene || null, config: plan.effectiveConfig };
      const id = photoIdentity(key);
      let task = plan.tasks.find(t => t.id === id);
      if (!task) {
        const framing = composition !== 'model' ? 'Producto completo, centrado, con márgenes libres, sin encuadre de cuerpo humano.' : area === 'upper_body' ? 'Encuadre desde muslos hasta encima de cabeza, prenda completa.' : area === 'lower_body' ? 'Encuadre desde pecho hasta debajo de pies, prenda completa.' : 'Prenda completa según su longitud, sin cortar ni tocar bordes.';
        const instructions = `${composition === 'flat_lay' ? 'Create a NEW flat lay photograph of ONLY the sold garments. REMOVE the person entirely: no human body, skin, face, hands, mannequin, hanger or folded garment. The person in the reference is only a source for the garment design; do NOT preserve that person, pose or camera framing. Arrange the exact quantities/components described below on a flat surface.' : ''}\n${scene?.prompt || ''}\nAtributos comerciales/evidencia de esta variante: ${canonicalPhotoJson(article.attributes)}\n${COMMON_PHOTO_INSTRUCTIONS}\n${view === 'back' ? 'BACK VIEW REQUIRED: show the rear of the garment and, for model photos, turn the entire body away from the camera. Do not substitute a front view.' : view === 'side' ? 'SIDE VIEW REQUIRED: strict lateral profile of the garment; for model photos turn the body 90 degrees. Do not substitute a front view.' : 'FRONT VIEW REQUIRED: straight frontal view of the garment.'}\nVista ${view}. ${framing} ${composition === 'flat_lay' ? 'Flat lay sobre superficie plana, sin persona, modelo ni maniquí; contenido completo y ordenado sin doblar.' : composition === 'model' ? `${audience === 'adult' ? 'Modelo adulto' : 'Modelo infantil apropiado a la talla de la prenda'}, una sola persona. De pie, frontal si vista front; ojos abiertos, boca cerrada, brazos a los lados; sin accesorios ajenos. ${base ? 'Cambia solo la prenda: preserva persona, pose, cámara, iluminación y fondo de la base verificada.' : identityBase ? 'Preserva la identidad exacta de la persona de referencia. Adapta fondo y encuadre a esta tarea; un fondo visualmente blanco de referencia no acredita RGB 255.' : 'Crea una persona fotorrealista enteramente sintética apropiada para el artículo.'}` : composition === 'reference' ? 'Usa exclusivamente el detalle real de la referencia, sin inventar ni ampliar contenido oculto.' : 'Producto protagonista; conserva sus componentes exactos.'}\n${background === 'white' ? 'Fondo blanco puro RGB 255,255,255; verifica el resultado, el prompt no acredita cumplimiento. Para prendas opacas de color oscuro identificado, se puede neutralizar únicamente el fondo casi blanco conectado al perímetro, conservando bordes y píxeles del producto; la imagen final debe revisarse después.' : background === 'original' ? 'Conserva fondo y píxeles de la referencia real.' : 'Fondo real neutro claro con contexto discreto y sombras naturales.'} ${channel === 'amazon' && main && audience === 'adult' && category === 'ordinary' && !pack ? 'Prenda aproximadamente 85% del encuadre según guía aplicable.' : ''}`;
        task = { ...(background === 'white' && knownPhotoAttribute(article.attributes.transparency) === false && /^(gris|gray|grey|azul|blue|negro|black|rojo|red|verde|green|marrón|brown)$/i.test(knownPhotoAttribute(article.attributes.color) || '') ? { backgroundCorrection: 'neutral-white-perimeter' as const } : {}), ...(scene ? { sceneId: scene.type } : {}), id, itemId: article.itemId, productId: article.productId, variantId: article.variantId, referencePaths: refs, view, composition, background, bodyArea: area, base, identityBase, syntheticPerformer, instructions, destinations: [] };
        plan.tasks.push(task);
      }
      task.destinations.push({ channel, productId: article.productId, variantId: article.variantId, position, role: main ? 'main' : 'alternative', required: main, ruleIds,
        ...(channel === 'shein' && main ? { imageType: 1, imageSort: 1 } : {}) });
    };
    for (const channel of channels) {
      const flat = pack || sensitiveChild || (child && channel === 'tiktok-shop') || (audience === 'baby' && channel === 'mercado-libre');
      const background = channel === 'tiktok-shop' || article.kind === 'garment' && channel === 'amazon' || pack ? 'white' : 'neutral';
      add(channel, 'front', background, flat, true);
      for (const view of ['back', 'side', 'detail'] as const) if (article.references.some(r => r.view === view)) {
        if (view === 'detail' && child && channel === 'tiktok-shop') issue(article.itemId, 'tiktok-child-detail', 'TikTok infantil: el detalle real no se asigna sin evidencia de flat lay sin personas. Las otras vistas planas se conservan.', false);
        else add(channel, view, child && channel === 'tiktok-shop' ? 'white' : view === 'detail' ? 'original' : 'neutral', flat, false);
      }
      if (!article.references.some(r => r.view === 'back')) issue(article.itemId, `optional-back-${channel}`, `${channel}: sin referencia de espalda; no se inventará esa vista.`, false);
    }
  }
  // All merged destinations carry the strictest compatible obligations in the approved task prompt.
  for (const task of plan.tasks) {
    const requirements = plan.rules.filter(r => r.verified && r.level === 'obligation' && task.destinations.some(d => d.ruleIds.includes(r.id)));
    task.instructions += '\n' + [...new Set(requirements.map(r => r.text))].join('\n');
  }
  plan.estimate.uniqueImages = plan.tasks.length;
  plan.estimate.generations = plan.tasks.filter(t => t.composition !== 'reference').length;
  plan.estimate.reviews = plan.tasks.length;
  plan.estimate.estimatedCostUsd = Number(plan.tasks.reduce((sum, t) => sum + (t.composition === 'reference' ? 0 : getProviderCostUsd(input.provider, input.imageConfig, t.referencePaths.length + (t.base || t.identityBase ? 1 : 0))) + .01, 0).toFixed(6));
  plan.id = photoIdentity({ ...plan, id: '' });
  return plan;
}

export function photoArticleFromGarment(garment: import('./types/garment').UploadedGarmentInput): PhotoArticle {
  return { itemId: garment.id, productId: garment.photoProductId || garment.id, variantId: garment.photoVariantId || garment.id, name: garment.name, kind: 'garment', attributes: garment.photoAttributes || {},
    references: (garment.photos || []).map(p => ({ id: p.id, storagePath: p.storagePath, view: p.isDetail ? 'detail' : p.view })) };
}
