"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFinalGenerationPrompt = exports.resolveApprovedJobOutput = exports.isActiveCatalogEntity = exports.isArchivedCatalogEntity = exports.isCatalogEntityStatus = exports.isAspectRatio = exports.isProvider = exports.isRole = exports.DEFAULT_TRY_ON_PROMPT = exports.PROVIDER_LABELS = exports.ASPECT_RATIO_VALUES = exports.PROVIDER_VALUES = exports.ROLE_VALUES = void 0;
exports.ROLE_VALUES = ['admin', 'operador', 'revisor'];
exports.PROVIDER_VALUES = ['fal-seedream', 'fal-banana-pro', 'openai-gpt-image-1.5'];
exports.ASPECT_RATIO_VALUES = ['9:16', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9'];
exports.PROVIDER_LABELS = {
    'fal-seedream': 'fal.ai seedream',
    'fal-banana-pro': 'fal.ai banana-pro',
    'openai-gpt-image-1.5': 'OpenAI gpt-image-1.5',
};
exports.DEFAULT_TRY_ON_PROMPT = `Replace the clothing worn by the model with the garment from the reference image.

STRICT PRESERVATION (HARD CONSTRAINTS — DO NOT MODIFY):
- Preserve 100% the model’s identity (face, body shape, skin tone, proportions)
- Preserve EXACT body pose, including spine curvature, limb position, and weight distribution
- Preserve EXACT head position and gaze direction:
  • If the model is looking at the camera, KEEP eye contact
  • If the head is tilted or rotated, KEEP the exact same angle
  • DO NOT change where the model is looking
- Preserve EXACT body orientation relative to the camera:
  • If front-facing, KEEP front-facing
  • If back-facing, KEEP back-facing
  • If side profile, KEEP the same side and angle
  • DO NOT rotate, mirror, or reinterpret the body
- Preserve original lighting, shadows, and highlights
- Preserve camera angle, lens perspective, framing, and depth of field
- Preserve the original background exactly as is

GARMENT FITTING REQUIREMENTS:
- Fit the garment naturally onto the body respecting the existing pose
- Follow the exact body orientation and head direction without correction or completion
- Maintain correct anatomy and proportions at all times
- Apply realistic fabric behavior:
  • natural folds based on tension and gravity
  • correct stretching/compression at joints
  • accurate contact with the body

GARMENT INTEGRITY (CRITICAL):
- Preserve the garment’s exact color, texture, stitching, and design
- Do NOT redesign, stylize, or enhance the garment
- Do NOT hallucinate missing parts — only use visible reference information
- Ensure perspective consistency with the scene

--------------------------------
BRAND & LOGO CONSTRAINTS (EXTREMELY STRICT)
--------------------------------

- Logos, text, or branding must ONLY be used if they are explicitly visible in the reference image AND in the corresponding visible area

- If a logo is visible in the reference:
  • Preserve its EXACT position, scale, and orientation
  • Do NOT move, reinterpret, or enhance it

- VISIBILITY RULE (CRITICAL PRIORITY):
  • If the reference image shows ONLY the front of the garment:
    - DO NOT render ANY logos or branding on areas not visible (e.g., back, sides, shoulders not shown)
    - EVEN IF the garment clearly has a logo on the front, DO NOT assume or replicate branding on unseen areas
    - The model must behave as if the unseen areas contain NO branding

- If the garment has a visible logo on the front but NO back view is provided:
  • The generated image MUST NOT contain ANY visible branding on the back or other unseen areas
  • The back must remain clean and free of logos

- Do NOT assume symmetry of branding (front ≠ back)
- Do NOT reconstruct hidden branding
- Do NOT generate additional or duplicate logos

--------------------------------
UNSEEN AREA CONSTRAINTS (CRITICAL)
--------------------------------

- Any part of the garment that is NOT visible in the reference image must be treated as UNKNOWN

- For UNKNOWN areas:
  • Apply only neutral continuation of base fabric
  • Continue color or pattern ONLY if clearly consistent and non-distinct
  • Avoid adding any new visual elements

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
- No “guessing” brand placement
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
const isRole = (value) => exports.ROLE_VALUES.includes(value);
exports.isRole = isRole;
const isProvider = (value) => exports.PROVIDER_VALUES.includes(value);
exports.isProvider = isProvider;
const isAspectRatio = (value) => exports.ASPECT_RATIO_VALUES.includes(value);
exports.isAspectRatio = isAspectRatio;
const isCatalogEntityStatus = (value) => value === 'active' || value === 'archived';
exports.isCatalogEntityStatus = isCatalogEntityStatus;
const isArchivedCatalogEntity = (value) => value?.status === 'archived';
exports.isArchivedCatalogEntity = isArchivedCatalogEntity;
const isActiveCatalogEntity = (value) => !(0, exports.isArchivedCatalogEntity)(value);
exports.isActiveCatalogEntity = isActiveCatalogEntity;
const resolveApprovedJobOutput = (job) => job.userSelectedOutput || job.currentOutput || null;
exports.resolveApprovedJobOutput = resolveApprovedJobOutput;
const buildFinalGenerationPrompt = (promptBase, garmentIsMultiAngle) => {
    const basePrompt = promptBase.trim() || exports.DEFAULT_TRY_ON_PROMPT;
    const sections = [basePrompt];
    if (garmentIsMultiAngle) {
        sections.push('La prenda de referencia esta mostrada desde multiples angulos dentro de una sola imagen.');
    }
    return sections.filter(Boolean).join('\n\n');
};
exports.buildFinalGenerationPrompt = buildFinalGenerationPrompt;
//# sourceMappingURL=domain.js.map