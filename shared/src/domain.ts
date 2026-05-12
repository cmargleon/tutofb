import {
  AspectRatio,
  CatalogEntityStatus,
  GarmentBodyArea,
  GarmentReferenceImageType,
  Job,
  JobOutput,
  ModelIdentityTraits,
  ModelPhotoProvider,
  Provider,
  Role,
  TryOnPromptCaseKey,
} from './types';

export const ROLE_VALUES: Role[] = ['admin', 'operador', 'revisor'];
export const PROVIDER_VALUES: Provider[] = [
  'fal-seedream',
  'fal-banana-pro',
  'openai-gpt-image-1.5',
  'fal-nano-banana-2',
  'fal-seedream-5',
  'fal-gpt-image-2',
];
export const ASPECT_RATIO_VALUES: AspectRatio[] = ['9:16', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9'];

export const PROVIDER_LABELS: Record<Provider, string> = {
  'fal-seedream': 'fal.ai Seedream v4.5',
  'fal-banana-pro': 'fal.ai Nano Banana Pro',
  'openai-gpt-image-1.5': 'OpenAI gpt-image-1.5',
  'fal-nano-banana-2': 'fal.ai Nano Banana 2',
  'fal-seedream-5': 'fal.ai Seedream 5 Lite',
  'fal-gpt-image-2': 'fal.ai GPT Image 2',
};

export const MODEL_PHOTO_PROVIDER_VALUES: ModelPhotoProvider[] = [
  'fal-seedream-v4.5',
  'fal-banana-pro',
  'openai-dalle',
  'fal-nano-banana-2',
  'fal-seedream-5',
  'fal-gpt-image-2',
];

export const MODEL_PHOTO_PROVIDER_TO_PROVIDER: Record<ModelPhotoProvider, Provider> = {
  'fal-seedream-v4.5': 'fal-seedream',
  'fal-banana-pro': 'fal-banana-pro',
  'openai-dalle': 'openai-gpt-image-1.5',
  'fal-nano-banana-2': 'fal-nano-banana-2',
  'fal-seedream-5': 'fal-seedream-5',
  'fal-gpt-image-2': 'fal-gpt-image-2',
};

export const MODEL_PHOTO_PROVIDER_LABELS: Record<ModelPhotoProvider, string> = {
  'fal-seedream-v4.5': 'Seedream v4.5 (fal.ai)',
  'fal-banana-pro': 'Nano Banana Pro (fal.ai)',
  'openai-dalle': 'OpenAI gpt-image-1.5',
  'fal-nano-banana-2': 'Nano Banana 2 (fal.ai)',
  'fal-seedream-5': 'Seedream 5 Lite (fal.ai)',
  'fal-gpt-image-2': 'GPT Image 2 (fal.ai)',
};

export const MODEL_PHOTO_PROVIDER_HINTS: Record<ModelPhotoProvider, string> = {
  'fal-seedream-v4.5': 'ByteDance · $0.04/foto',
  'fal-banana-pro': 'Gemini Pro · $0.15/foto base, $0.30 en 4K',
  'openai-dalle': 'OpenAI · $0.02-$0.25/foto segun quality y size',
  'fal-nano-banana-2': 'Gemini 3.1 Flash · $0.06-$0.16/foto segun resolucion',
  'fal-seedream-5': 'ByteDance v5 · $0.035/foto',
  'fal-gpt-image-2': 'OpenAI · $0.01-$0.41/foto segun quality y tamano',
};

export const mapModelPhotoProviderToProvider = (provider: ModelPhotoProvider): Provider =>
  MODEL_PHOTO_PROVIDER_TO_PROVIDER[provider];

export const INTERNAL_GARMENT_DETAILS_PROMPT_MARKER = 'INTERNAL GARMENT DETAILS (CRITICAL)';

export const INTERNAL_GARMENT_DETAILS_PROMPT_BLOCK =
  `--------------------------------
${INTERNAL_GARMENT_DETAILS_PROMPT_MARKER}
--------------------------------

- Treat neck labels, inner tags, care labels, size labels, and any label sewn to the inside of the garment as INTERNAL-ONLY details by default
- If an internal label is visible in the reference only because the garment is laid flat, zoomed in, or slightly open, DO NOT reproduce it as an exterior patch, badge, logo, or decoration
- Only render a label or tag as externally visible when the reference clearly shows it is intentionally placed on the outside of the garment
- Do NOT convert internal branding into visible outer branding
- Do NOT place inner collar or neckline labels on the outside of the garment unless the reference clearly proves that placement`;

export const CARRY_ACCESSORY_PROMPT_MARKER = 'CARRY ACCESSORY RULES (CRITICAL)';

export const CARRY_ACCESSORY_PROMPT_BLOCK =
  `--------------------------------
${CARRY_ACCESSORY_PROMPT_MARKER}
--------------------------------

- The reference item may be a carry accessory, such as a backpack, shoulder bag, crossbody bag, handbag, tote bag, duffel bag, or similar bag-like product
- If the reference item is a carry accessory, DO NOT reinterpret it as clothing
- Preserve the accessory as a separate object carried or worn by the model, not as a shirt, jacket, pants, logo, patch, or background prop
- Place the accessory only in a physically plausible visible position for its type:
  - backpack: on the back or over visible shoulders/straps
  - shoulder bag or tote: hanging from a visible shoulder, arm, or hand
  - crossbody bag: strap crossing the visible torso with the bag visible
  - handbag or duffel: held by a visible hand/arm or hanging near the side of the body
- Do NOT remove the model's existing base clothing unless the accessory explicitly covers it
- Keep straps, handles, buckles, zippers, pockets, proportions, material, color, and branding faithful to the reference
- If the selected pose does not expose the required body area for that accessory, do not invent a hidden placement`;

export const DEFAULT_TRY_ON_PROMPT =
  `Replace the clothing worn by the model with the garment from the reference image.

STRICT PRESERVATION (HARD CONSTRAINTS - DO NOT MODIFY):
- Preserve 100% the model's identity (face, body shape, skin tone, proportions)
- Preserve EXACT body pose, including spine curvature, limb position, and weight distribution
- Preserve EXACT head position and gaze direction:
  - If the model is looking at the camera, KEEP eye contact
  - If the head is tilted or rotated, KEEP the exact same angle
  - DO NOT change where the model is looking
- Preserve EXACT body orientation relative to the camera:
  - If front-facing, KEEP front-facing
  - If back-facing, KEEP back-facing
  - If side profile, KEEP the same side and angle
  - DO NOT rotate, mirror, or reinterpret the body
- Preserve original lighting, shadows, and highlights
- Preserve camera angle, lens perspective, framing, and depth of field
- Preserve the original background exactly as is

GARMENT FITTING REQUIREMENTS:
- Fit the garment naturally onto the body respecting the existing pose
- Follow the exact body orientation and head direction without correction or completion
- Maintain correct anatomy and proportions at all times
- Apply realistic fabric behavior:
  - natural folds based on tension and gravity
  - correct stretching/compression at joints
  - accurate contact with the body

GARMENT INTEGRITY (CRITICAL):
- Preserve the garment's exact color, texture, stitching, and design
- Do NOT redesign, stylize, or enhance the garment
- Do NOT hallucinate missing parts - only use visible reference information
- Ensure perspective consistency with the scene

--------------------------------
BRAND & LOGO CONSTRAINTS (EXTREMELY STRICT)
--------------------------------

- Logos, text, or branding must ONLY be used if they are explicitly visible in the reference image AND in the corresponding visible area

- If a logo is visible in the reference:
  - Preserve its EXACT position, scale, and orientation
  - Do NOT move, reinterpret, or enhance it

- VISIBILITY RULE (CRITICAL PRIORITY):
  - If the reference image shows ONLY the front of the garment:
    - DO NOT render ANY logos or branding on areas not visible (e.g., back, sides, shoulders not shown)
    - EVEN IF the garment clearly has a logo on the front, DO NOT assume or replicate branding on unseen areas
    - The model must behave as if the unseen areas contain NO branding

- If the garment has a visible logo on the front but NO back view is provided:
  - The generated image MUST NOT contain ANY visible branding on the back or other unseen areas
  - The back must remain clean and free of logos

- Do NOT assume symmetry of branding (front != back)
- Do NOT reconstruct hidden branding
- Do NOT generate additional or duplicate logos

${INTERNAL_GARMENT_DETAILS_PROMPT_BLOCK}

${CARRY_ACCESSORY_PROMPT_BLOCK}

--------------------------------
UNSEEN AREA CONSTRAINTS (CRITICAL)
--------------------------------

COLOR CONSISTENCY (CRITICAL - HARD CONSTRAINT):
- The garment color MUST exactly match the reference image
- DO NOT alter hue, saturation, or brightness of the garment
- DO NOT introduce lighting-based color shifts (no darker/lighter reds)
- The red color must remain uniform across the entire garment
- Avoid shadows that tint the garment toward maroon, orange, or pink
- If lighting affects perception, correct it to maintain true color fidelity

- Any part of the garment that is NOT visible in the reference image must be treated as UNKNOWN

- For UNKNOWN areas:
  - Apply only neutral continuation of base fabric
  - Continue color or pattern ONLY if clearly consistent and non-distinct
  - Avoid adding any new visual elements

STRICTLY FORBIDDEN in unseen areas:
- Logos, brand marks, or symbols
- Text, typography, or graphics
- High-contrast shapes resembling branding
- Any design element not explicitly visible in the reference

- The system must behave as if it has ZERO knowledge beyond what is visible

--------------------------------
STRICT NEGATIVE CONSTRAINTS (AVOID AT ALL COSTS)
--------------------------------

- No adding logos to areas not visible in the reference
- No guessing brand placement
- No front/back symmetry assumptions
- No change in gaze direction or head orientation
- No pose correction or symmetry fixing
- No identity drift
- No lighting inconsistencies
- No background changes
- No artifacts or distortions

--------------------------------
OUTPUT
--------------------------------

Generate a photorealistic, high-detail fashion catalog image with:
- strict pose preservation
- correct gaze direction
- accurate garment reproduction
- ZERO hallucinated branding
- clean treatment of unseen areas`;

export const DEFAULT_TRY_ON_PROMPT_CASES: Record<TryOnPromptCaseKey, string> = {
  full_outfit: `GARMENT TYPE RULE - CASE A - FULL OUTFIT:
- Apply the complete outfit exactly as shown
- Do not modify, replace, or invent any part`,
  top_only: `GARMENT TYPE RULE - CASE B - TOP ONLY:
- Apply the top exactly as shown
- For the bottom: ALWAYS use plain black leggings
- Leggings must be simple, with no logos, textures, or patterns
- Never generate bottom garments outside this fallback rule`,
  bottom_only: `GARMENT TYPE RULE - CASE C - BOTTOM ONLY:
- Apply the bottom exactly as shown
- For the top: ALWAYS use a plain white fitted bodysuit
- The bodysuit must have no logos, textures, or patterns
- Never generate top garments outside this fallback rule`,
  carry_accessory: `GARMENT TYPE RULE - CASE D - CARRY ACCESSORY:
- The reference item is a carry accessory, not clothing
- Keep the model's clothing, body, face, pose, lighting, and background stable
- Add or replace only the visible carry accessory according to its type and plausible attachment point
- Never turn the accessory into apparel, a printed graphic, or a decorative background object`,
};

export const resolveTryOnPromptCaseKey = (
  garmentBodyArea?: GarmentBodyArea | null,
): TryOnPromptCaseKey | null => {
  switch (garmentBodyArea) {
    case 'full_body':
      return 'full_outfit';
    case 'upper_body':
      return 'top_only';
    case 'lower_body':
      return 'bottom_only';
    case 'carry_accessory':
      return 'carry_accessory';
    default:
      return null;
  }
};

export const getDefaultTryOnPromptCaseText = (promptCaseKey: TryOnPromptCaseKey): string =>
  DEFAULT_TRY_ON_PROMPT_CASES[promptCaseKey];

export const isRole = (value: unknown): value is Role => ROLE_VALUES.includes(value as Role);
export const isProvider = (value: unknown): value is Provider => PROVIDER_VALUES.includes(value as Provider);
export const isAspectRatio = (value: unknown): value is AspectRatio => ASPECT_RATIO_VALUES.includes(value as AspectRatio);
export const isCatalogEntityStatus = (value: unknown): value is CatalogEntityStatus =>
  value === 'active' || value === 'archived';
export const isArchivedCatalogEntity = (value: { status?: CatalogEntityStatus | null } | null | undefined): boolean =>
  value?.status === 'archived';
export const isActiveCatalogEntity = (value: { status?: CatalogEntityStatus | null } | null | undefined): boolean =>
  !isArchivedCatalogEntity(value);
export const resolveApprovedJobOutput = (job: Pick<Job, 'userSelectedOutput' | 'currentOutput'>): JobOutput | null =>
  job.userSelectedOutput || job.currentOutput || null;

const MODEL_IDENTITY_TRAIT_LABELS: Record<keyof ModelIdentityTraits, string> = {
  sex: 'Biological sex / presentation anchor',
  age: 'Apparent age anchor',
  skin: 'Skin tone anchor',
  hairColor: 'Hair color anchor',
  hairLength: 'Hair length anchor',
  build: 'Body build anchor',
};

const buildModelIdentityTraitLines = (identityTraits?: ModelIdentityTraits | null): string[] => {
  if (!identityTraits) {
    return [];
  }

  return (Object.entries(MODEL_IDENTITY_TRAIT_LABELS) as Array<[keyof ModelIdentityTraits, string]>)
    .map(([key, label]) => {
      const value = identityTraits[key];
      return typeof value === 'string' && value.trim()
        ? `- ${label}: ${value.trim()}`
        : null;
    })
    .filter((entry): entry is string => Boolean(entry));
};

export const buildModelIdentityPromptBlock = (identityTraits?: ModelIdentityTraits | null): string => {
  const traitLines = buildModelIdentityTraitLines(identityTraits);

  return [
    'IDENTITY PRESERVATION RULES (ABSOLUTE PRIORITY):',
    '- The generated person must remain the exact same individual shown in the selected pose/model reference image.',
    '- Treat the pose/model image as the source of truth for identity.',
    '- If any other instruction conflicts with preserving identity, preserving identity wins.',
    '- Preserve the same facial structure, skin tone, apparent age, body proportions, and visible hair identity.',
    '- Do NOT swap to a different person, ethnicity, age group, face, or hairstyle.',
    '- Do NOT age up, age down, beautify, editorialize, or stylize the face in a way that changes who the model is.',
    '- Brand styling, mood, polish, and expression can be adjusted only if the selected model still reads as the same person.',
    ...(traitLines.length > 0
      ? [
          'IDENTITY ANCHORS FROM THE SELECTED MODEL:',
          ...traitLines,
        ]
      : []),
  ].join('\n');
};

export const applyGlobalTryOnPromptGuards = (promptBase: string): string => {
  const normalizedPrompt = promptBase.trim() || DEFAULT_TRY_ON_PROMPT;
  if (normalizedPrompt.includes(INTERNAL_GARMENT_DETAILS_PROMPT_MARKER)) {
    return normalizedPrompt;
  }

  return [normalizedPrompt, INTERNAL_GARMENT_DETAILS_PROMPT_BLOCK].join('\n\n');
};

export const buildFinalGenerationPrompt = (
  promptBase: string,
  garmentReferenceImageType: GarmentReferenceImageType | boolean = 'single_view',
  promptCaseText?: string | null,
  modelIdentityTraits?: ModelIdentityTraits | null,
): string => {
  const basePrompt = applyGlobalTryOnPromptGuards(promptBase);
  const normalizedPromptCaseText = typeof promptCaseText === 'string' ? promptCaseText.trim() : '';
  const sections = [buildModelIdentityPromptBlock(modelIdentityTraits), basePrompt];
  const usesMultiAngleReference =
    garmentReferenceImageType === true || garmentReferenceImageType === 'multi_angle_composite';

  if (normalizedPromptCaseText) {
    sections.push(normalizedPromptCaseText);
  }

  if (usesMultiAngleReference) {
    sections.push(
      'La referencia de la prenda incluye multiples angulos. Usa esas vistas solo para reconstruir con precision la misma prenda, sin inventar detalles no visibles.',
    );
  }

  return sections.filter(Boolean).join('\n\n');
};

export default {
  ROLE_VALUES,
  PROVIDER_VALUES,
  MODEL_PHOTO_PROVIDER_VALUES,
  ASPECT_RATIO_VALUES,
  PROVIDER_LABELS,
  MODEL_PHOTO_PROVIDER_LABELS,
  MODEL_PHOTO_PROVIDER_HINTS,
  MODEL_PHOTO_PROVIDER_TO_PROVIDER,
  mapModelPhotoProviderToProvider,
  DEFAULT_TRY_ON_PROMPT,
  DEFAULT_TRY_ON_PROMPT_CASES,
  resolveTryOnPromptCaseKey,
  getDefaultTryOnPromptCaseText,
  isRole,
  isProvider,
  isAspectRatio,
  isCatalogEntityStatus,
  isArchivedCatalogEntity,
  isActiveCatalogEntity,
  resolveApprovedJobOutput,
  buildModelIdentityPromptBlock,
  applyGlobalTryOnPromptGuards,
  buildFinalGenerationPrompt,
};
