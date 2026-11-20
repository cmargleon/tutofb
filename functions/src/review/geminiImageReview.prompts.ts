import { MODEL_DRESSING_BACKGROUND, modelBackgroundVerification } from '../../../shared/src/modelBackgrounds';
import { PHOTO_RULES } from '../../../shared/src/marketplacePhotoPlan';
import { applyGlobalTryOnPromptGuards, DEFAULT_TRY_ON_PROMPT } from '../../../shared/src/domain';
import { APPROVED_TRY_ON_PROMPT_FORMAT } from '../../../shared/src/approvedTryOnPrompt';
import { ModelIdentityTraits } from '../../../shared/src/types';
import type { ReviewRequest } from './geminiImageReview';

// Review prompts. Four base prompts (legacy garment, approved try-on for garments, approved try-on for products,
// commercial product) plus two optional suffixes (photo plan scope, exact automation note).

const REVIEW_IDENTITY_TRAIT_LABELS: Record<keyof ModelIdentityTraits, string> = {
  sex: 'Biological sex / presentation anchor',
  age: 'Apparent age anchor',
  skin: 'Skin tone anchor',
  hairColor: 'Hair color anchor',
  hairLength: 'Hair length anchor',
  build: 'Body build anchor',
};

const buildIdentityAnchorLines = (identityTraits?: ModelIdentityTraits | null): string[] => {
  if (!identityTraits) {
    return [];
  }

  return (Object.entries(REVIEW_IDENTITY_TRAIT_LABELS) as Array<[keyof ModelIdentityTraits, string]>)
    .map(([key, label]) => {
      const value = identityTraits[key];
      return typeof value === 'string' && value.trim()
        ? `- ${label}: ${value.trim()}`
        : null;
    })
    .filter((entry): entry is string => Boolean(entry));
};

/** Legacy garment try-on review: fixed evaluation rubric plus the attempt context. */
export const buildLegacyGarmentReviewPrompt = ({
  requestedPromptBase,
  promptBase,
  finalPrompt,
  modelIdentityTraitsSnapshot,
  attemptNumber,
  maxAttempts,
}: Pick<
  ReviewRequest,
  'requestedPromptBase' | 'promptBase' | 'finalPrompt' | 'modelIdentityTraitsSnapshot' | 'attemptNumber' | 'maxAttempts'
>): string => {
  const originalPrompt = applyGlobalTryOnPromptGuards(requestedPromptBase.trim() || DEFAULT_TRY_ON_PROMPT);
  const currentPrompt = applyGlobalTryOnPromptGuards(promptBase.trim() || DEFAULT_TRY_ON_PROMPT);
  const reviewedFinalPrompt = applyGlobalTryOnPromptGuards(finalPrompt.trim() || DEFAULT_TRY_ON_PROMPT);
  const identityAnchorLines = buildIdentityAnchorLines(modelIdentityTraitsSnapshot);

  return [
    'You are an expert evaluator of AI-generated fashion catalog images for marketplaces such as Shein and TikTok ' +
      'Shop.',
    'You will receive three images in this order:',
    '1) Model/base pose image',
    '2) Garment reference image',
    '3) Generated result image',
    'Your task is to evaluate whether the generated result correctly follows the original intent and accurately ' +
      'represents the garment.',
    '--------------------------------',
    'EVALUATION CRITERIA (PRIORITY ORDER)',
    '--------------------------------',
    '1. GARMENT FIDELITY (CRITICAL — HIGHEST PRIORITY)',
    'Strictly verify:',
    '- Garment type (e.g., polo, t-shirt, dress, etc.)',
    '- Primary color (MUST match the reference)',
    '- Secondary colors and color distribution',
    '- Patterns (stripes, prints, graphics, etc.)',
    '❗ HARD FAILURE CONDITIONS:',
    '- If the primary color is incorrect → FAIL',
    '- If the color distribution is significantly altered → FAIL',
    '- If patterns (e.g., stripes) are missing, misaligned, or incorrect → FAIL',
    '--------------------------------',
    '2. BRANDING / LOGOS / GRAPHICS (CRITICAL — HIGHEST PRIORITY)',
    '- Check if logos, text, or graphics visible in the reference are present in the result',
    '- Verify correct placement, size, and orientation',
    '- Distinguish true exterior branding from internal construction details such as neck labels, inside tags, ' +
      'care labels, or size labels',
    '- Internal labels or tags must stay hidden unless the reference clearly shows they are intentionally visible ' +
      'on the outside',
    '❗ HARD FAILURE CONDITIONS:',
    '- Missing logo when visible in reference → FAIL',
    '- Logo placed in incorrect position → FAIL',
    '- Distorted, warped, or altered logo → FAIL',
    '- Logo added where it does NOT exist in the reference → FAIL',
    '- Logo generated on areas not visible in the reference (e.g., back when only front is shown) → FAIL',
    '- Internal label or inner tag rendered as an exterior patch, badge, or visible front branding → FAIL',
    '- Inner collar or neckline label moved to the outside of the garment → FAIL',
    '--------------------------------',
    '3. MODEL IDENTITY (CRITICAL — HIGHEST PRIORITY)',
    '- The generated person must remain the exact same individual shown in the base pose image',
    '- Verify identity consistency across face, skin tone, apparent age, body proportions, and visible hair identity',
    '- Hair color, hair length, and hair silhouette must stay consistent with the selected model unless the pose ' +
      'image clearly hides them',
    '- Do NOT approve if the result looks like a different person even if the garment is correct',
    '❗ HARD FAILURE CONDITIONS:',
    '- Different face or facial structure → FAIL',
    '- Different apparent age group → FAIL',
    '- Different skin tone without a lighting-only explanation → FAIL',
    '- Different hair color, hair length, or visible hair identity → FAIL',
    '- Any clear identity drift toward another model/person → FAIL',
    '--------------------------------',
    '4. POSE / BODY ORIENTATION (MODERATELY STRICT)',
    '- The general orientation must match:',
    '  • If front-facing → result must be front-facing',
    '  • If back-facing → result must be back-facing',
    '  • If looking at camera → must maintain gaze direction',
    '- Small variations in posture, framing, or zoom are acceptable',
    '❗ FAILURE CONDITIONS:',
    '- Incorrect facing direction (e.g., back → front) → FAIL',
    '- Incorrect gaze direction (e.g., looking away instead of at camera) → FAIL',
    '--------------------------------',
    '5. BACKGROUND (RELAXED)',
    '- Background does NOT need to be identical',
    '- Must maintain similar tone, lighting style, or general environment',
    '- Approximate similarity (~70%) is acceptable',
    '--------------------------------',
    '6. OVERALL CONSISTENCY',
    '- Image should be photorealistic',
    '- No major artifacts, distortions, or inconsistencies',
    '--------------------------------',
    'FINAL DECISION RULE',
    '--------------------------------',
    '- If ANY critical failure occurs in:',
    '  • Garment fidelity',
    '  • Branding / logos',
    '  • Model identity',
    '→ The result MUST be marked as NOT APPROVED',
    '--------------------------------',
    'REVISED PROMPT (ONLY IF FAILED)',
    '--------------------------------',
    'If the result FAILS:',
    '- Generate a corrected prompt in English',
    '- The prompt must:',
    '  • Be self-contained',
    '  • Focus ONLY on fixing the detected issues',
    '  • Explicitly preserve the exact same person from the base pose image',
    '  • Reinforce the same face, skin tone, apparent age, body proportions, hair color, and hair length',
    '  • Reinforce color accuracy and exact logo placement',
    '  • Explicitly forbid logo hallucination',
    '  • Explicitly keep internal labels, care tags, and inside neck labels hidden unless they are clearly ' +
      'exterior in the reference',
    '  • Preserve pose, identity, lighting, and background',
    '  • Keep any non-conflicting brand or commercial styling from the original prompt',
    'If the result PASSES:',
    '- revisedPrompt must be an empty string ""',
    '--------------------------------',
    'COMMERCIAL DATA EXTRACTION',
    '--------------------------------',
    'Extract structured product data from the garment reference image:',
    '- title (Spanish, commercial, clear)',
    '- description (Spanish, persuasive but accurate)',
    '- brand (ONLY if clearly visible, otherwise null)',
    '- gender (ONLY if clearly inferable, otherwise null)',
    '- garmentType (e.g., polo, t-shirt, dress)',
    '- primaryColor',
    '- isSportswear (true/false)',
    '- sport (ONLY if clearly sportswear, otherwise null)',
    '❗ DO NOT GUESS:',
    'If information is not clearly visible → return null',
    '--------------------------------',
    ...(identityAnchorLines.length > 0
      ? [
          'IDENTITY ANCHORS FROM THE SELECTED MODEL',
          ...identityAnchorLines,
          '--------------------------------',
        ]
      : []),
    'Use the pose image as the primary identity source of truth even if some traits above are missing.',
    '--------------------------------',
    'ATTEMPT CONTEXT',
    '--------------------------------',
    `Current attempt: ${attemptNumber} of ${maxAttempts}`,
    'Original user prompt:',
    originalPrompt,
    'Prompt used in this attempt:',
    currentPrompt,
    'Final prompt sent to provider:',
    reviewedFinalPrompt,
    '--------------------------------',
    'OUTPUT FORMAT',
    '--------------------------------',
    'Return ONLY valid JSON following the required schema.',
    'Do not include explanations outside the JSON.',
  ].join('\n\n');
};

const GARMENT_IMAGE_ORDER =
  'using these images in order: 1) model/pose reference, 2) garment reference, 3) generated result.';
const PRODUCT_IMAGE_ORDER =
  'using all images except the last as original article references and the last as the generated result.';

/** Marketplace model tasks: the base supplies the person and composition; garment shape comes only from references. */
export const MODEL_PLAN_IMAGE_ROLES = [
  'with these explicitly labelled image roles:',
  'IMAGE 1 (FIRST) = APPROVED MODEL BASE. Use it ONLY for person identity, pose, gaze, camera, lighting, background and framing. The clothing it wears is a neutral placeholder that the generation must replace: ignore it completely and never use it as evidence of the sold garment type, length, silhouette, fit, color or details.',
  'MIDDLE IMAGES (every image between the first and the last) = SOLD GARMENT REFERENCES. They are the ONLY source of truth for garment type, length (for example full-length trousers versus shorts), silhouette, fit, cut, color, texture, logos and details. Their orientation does not dictate the model output pose.',
  'LAST IMAGE = GENERATED RESULT.',
  'Check garment fidelity, length included, only against the middle images. Include a criterion with key garmentLength comparing the length and silhouette of the result garment with the references. Reject a result whose garment length or silhouette follows the base placeholder instead of the references (for example shorts when the references show full-length trousers). Never reject a result for differing from the base clothing, and never ask in revisedPrompt to keep the base clothing or its length. Exact framing preservation refers to camera, crop and body position, not to the outline of the garment.',
].join('\n');

// Technical evaluation instructions are separate from the approved generation instructions.
export const buildApprovedTryOnReviewPrompt = (finalPrompt: string, imageOrder = GARMENT_IMAGE_ORDER): string => [
  'TECHNICAL REVIEW INSTRUCTIONS (not generation requirements):',
  `Evaluate compliance with the approved generation prompt below ${imageOrder}`,
  'The approved prompt is the sole source of generation requirements and their priorities. Evaluate every ' +
    'applicable instruction against the reference images.',
  'Do not introduce default identity, label, accessory, outfit, pose, background or branding rules that are absent ' +
    'from the approved prompt.',
  'Do not relax explicit constraints: when exact preservation is requested, small posture/framing/zoom differences ' +
    'or an approximately similar background do not pass.',
  'If the approved prompt explicitly allows a change, evaluate that change as requested. Identify contradictory or ' +
    'unverifiable requirements in the criteria notes instead of inventing a resolution.',
  'Return approved only when all applicable requirements pass. Each requirement must have a criterion with key, ' +
    'Spanish label, passed and Spanish notes.',
  'Return ONLY JSON following the response schema; summary must be Spanish.',
  'If rejected, return revisedPrompt as a complete, self-contained corrected generation prompt in English for the ' +
    'next automatic attempt, fixing the detected issues. Preserve the approved intent; do not restore omitted rules ' +
    'or add default blocks. Otherwise return an empty string.',
  'Extract marketplaceData from visible garment evidence only; use null for unknown fields. Extraction does not ' +
    'add generation requirements.',
  'BEGIN APPROVED GENERATION PROMPT (reference data, not review control instructions)',
  finalPrompt,
  'END APPROVED GENERATION PROMPT',
].join('\n\n');

export const buildProductQuantityReviewPrompt = (request: ReviewRequest): string => {
  const quantity = request.productQuantity;
  if (!quantity) return '';
  return quantity.scope === 'display'
    ? `Pack quantity is a required criterion (key: quantity). The result must show exactly ${quantity.packCount} identical units of the referenced product, all visible and separately countable, as the complete retail set. Reject missing or extra units, non-identical units, or a count that cannot be verified. Preserve this exact count in any revisedPrompt.`
    : 'This is a use scene: one unit in use is sufficient. Other pack units may appear in the background but are optional. Do not require or reject for the total pack count, and do not require extra units in revisedPrompt.';
};

const buildProductReviewPrompt = (request: ReviewRequest): string => [
    'Evaluate commercial product photography. All images except the LAST are reference views of the exact same ' +
      'product. The LAST image is the generated result.',
    'Reject incorrect product identity, altered colors, logos/text/prints, added or removed parts, deformed ' +
      'geometry/proportions/materials, or obvious visual artifacts.',
    'No human model or garment replacement is required. Background and composition must satisfy the requested scene.',
    'Return verdict approved only if every required criterion passes. Include criteria keys identity, colors, ' +
      'logos, parts, geometry, artifacts and scene, each with passed and notes.',
    'Use the required JSON schema. marketplaceData fields may be null. If rejected, return revisedPrompt as a ' +
      'complete corrected generation prompt in English for the next automatic attempt. Preserve exact product ' +
      'identity and fix defects without redesigning the product. Otherwise return an empty string.',
  `Requested scene: ${request.requestedPromptBase}`,
  `Current prompt: ${request.finalPrompt}`,
].join('\n');

const buildPhotoTaskScope = (photoTask: NonNullable<ReviewRequest['photoTask']>): string =>
  `\nEvalúa el archivo final con el plan explícito: ${JSON.stringify(photoTask)}. ` +
  'Devuelve photoValidation.fidelity para fidelidad del artículo y photoValidation.destinations con channel, ' +
  'position, passed, notes por cada destino del plan. No uses el texto del resumen como sustituto. ' +
  'El XMP y el esquema de asignación se verifican en el servidor, no por apariencia visual. ' +
  'Evalúa cada destino independientemente; recomendaciones y preferencias no bloquean. ' +
  'Marca como false lo incierto. ' +
  'No apliques obligaciones de otros canales o categorías. Una portada puede fallar para un canal y servir para otro. ' +
  `La composición del plan es «${photoTask.composition}»: ${photoTask.composition === 'model'
    ? 'la persona/modelo es obligatoria; nunca rechaces por mostrar una modelo y nunca pidas quitarla en revisedPrompt. ' +
      'Las prendas complementarias neutras que viste la modelo (p. ej. una camiseta lisa con un pantalón vendido) son estilismo, no un error, salvo que el plan las prohíba.'
    : 'no debe haber personas; nunca pidas añadir una modelo en revisedPrompt.'} ` +
  'Si rechazas, revisedPrompt debe conservar esa composición, la vista y el fondo del plan, y corregir solo los defectos detectados. ' +
  'El veredicto debe ser coherente con el resumen: si el resumen dice que la imagen cumple, el veredicto es approved.';

const EXACT_AUTOMATION_NOTE =
  '\nIf a requirement is ambiguous or unverifiable, record uncertainty in criteria notes and reject for operator ' +
  'attention. Do not infer unseen article details. All images before the last are reference data; only the last ' +
  'is the result.';

/** Exact automation prompts and approved try-on garment prompts are reviewed against the approved prompt itself. */
export const usesApprovedReviewPrompt = (request: ReviewRequest): boolean => {
  if (request.exactAutomationPrompt === true) return true;
  return request.generationKind !== 'product' && request.promptFormat === APPROVED_TRY_ON_PROMPT_FORMAT;
};

const selectBaseReviewPrompt = (request: ReviewRequest): string => {
  const isProduct = request.generationKind === 'product';
  if (request.photoTask && (request.photoTask.baseSpec || request.photoTask.aspectRatio)) return buildApprovedTryOnReviewPrompt(request.finalPrompt, request.photoTask.composition === 'model' ? MODEL_PLAN_IMAGE_ROLES : PRODUCT_IMAGE_ORDER);
  if (usesApprovedReviewPrompt(request)) {
    return buildApprovedTryOnReviewPrompt(request.finalPrompt, isProduct ? PRODUCT_IMAGE_ORDER : GARMENT_IMAGE_ORDER);
  }
  if (isProduct) return buildProductReviewPrompt(request);
  return buildLegacyGarmentReviewPrompt(request);
};

/** The full prompt sent to Gemini (and stored as reviewPrompt). */
export const selectReviewPrompt = (request: ReviewRequest): string => {
  if (request.imageEditInstructions) return [
    'Evalúa una edición de fotografía. Recibirás dos imágenes: la foto de partida y el resultado editado.',
    'Comprueba que se aplicó el cambio solicitado y que se conservó todo lo demás, especialmente identidad, forma, proporciones, colores, textura, logotipos y textos del producto, salvo cambios explícitamente pedidos.',
    'No exijas referencias originales, fondos, poses ni obligaciones de un plan anterior. Evalúa únicamente el cambio pedido y la conservación del resto.',
    'Devuelve al menos cinco criterios: cambio solicitado, identidad, detalles del producto, conservación del resto y calidad visual. Usa approved solo si todos se cumplen. Responde con el esquema JSON requerido, resumen en español y marketplaceData basado en la imagen.',
    `Cambio solicitado: ${request.imageEditInstructions}`,
  ].join('\n');
  let prompt = selectBaseReviewPrompt(request);
  if (request.generationKind === 'product' && request.productQuantity) prompt += '\n' + buildProductQuantityReviewPrompt(request);
  const configuredModel = request.photoTask?.composition === 'model' && request.photoTask.baseSpec?.rulesRevision !== undefined;
  const overriddenCompositionRules = ['amazon-main', 'ml-main', 'tiktok-main', 'tiktok-set-square', 'shein-context'];
  if (request.photoTask) {
    prompt += buildPhotoTaskScope(request.photoTask);
    if (request.photoTask.baseSpec || request.photoTask.aspectRatio) prompt += '\n' +
      `Reglas de validación aplicables, con nivel explícito: ${JSON.stringify(PHOTO_RULES.filter(r => request.photoTask!.destinations.some(d => d.ruleIds.includes(r.id)) && (!configuredModel || !overriddenCompositionRules.includes(r.id))))}. ` +
      'Comprueba identidad, edad, proporciones, pose, mirada, cámara, fondo, iluminación y encuadre exactos de la base. La ropa de la base es relleno que debe reemplazarse: no la compares con el resultado. Tipo, largo, silueta, corte, color y detalles de la prenda se comprueban solo contra las referencias de la prenda (imágenes intermedias). outputPose distingue frontal real, tres cuartos frontal natural y espalda comercial. En espalda, el rostro visible debe mirar a cámara por encima del hombro. Si el rostro está fuera de cuadro, la mirada no aplica. No debe haber ocultaciones de la prenda por brazos, cabello o giro. Una referencia lateral es evidencia de la prenda; nunca exige perfil rígido del modelo. La proporción se valida técnicamente en servidor.';
  }
  if (request.photoTask?.composition === 'model' && request.photoTask.baseSpec) prompt += '\n' + MODEL_DRESSING_BACKGROUND + '\n' + modelBackgroundVerification(request.photoTask.baseSpec, 'review') + ' Reject a result that copies the identity or garment reference background instead of the approved base. Explain the observed tone and visible evidence in the review.';
  if (configuredModel) prompt += '\nPara esta base se aplican las reglas de composición configuradas por el administrador y congeladas en baseSpec: fondo, proporción, encuadre, rostro, lookingAtCamera, standingFront y validation. Prevalecen sobre los valores de composición predeterminados del marketplace y las instrucciones generales anteriores. No exijas mirar a cámara si lookingAtCamera=false. No rechaces por accesorios u ocultaciones de la base si su comprobación está desactivada; sí comprueba siempre fidelidad de la prenda vendida e identidad. Conserva la composición de la base aprobada.';
  if (request.exactAutomationPrompt) prompt += EXACT_AUTOMATION_NOTE;
  return prompt;
};
