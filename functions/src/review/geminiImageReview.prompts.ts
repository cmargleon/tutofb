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
  if (request.photoTask) prompt += buildPhotoTaskScope(request.photoTask);
  if (request.exactAutomationPrompt) prompt += EXACT_AUTOMATION_NOTE;
  return prompt;
};
