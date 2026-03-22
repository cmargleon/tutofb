"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFinalGenerationPrompt = exports.isActiveCatalogEntity = exports.isArchivedCatalogEntity = exports.isCatalogEntityStatus = exports.isAspectRatio = exports.isProvider = exports.isRole = exports.DEFAULT_TRY_ON_PROMPT = exports.PROVIDER_LABELS = exports.ASPECT_RATIO_VALUES = exports.PROVIDER_VALUES = exports.ROLE_VALUES = void 0;
exports.ROLE_VALUES = ['admin', 'operador', 'revisor'];
exports.PROVIDER_VALUES = ['fal-seedream', 'fal-banana-pro', 'openai-gpt-image-1.5'];
exports.ASPECT_RATIO_VALUES = ['9:16', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9'];
exports.PROVIDER_LABELS = {
    'fal-seedream': 'fal.ai seedream',
    'fal-banana-pro': 'fal.ai banana-pro',
    'openai-gpt-image-1.5': 'OpenAI gpt-image-1.5',
};
exports.DEFAULT_TRY_ON_PROMPT = `Replace only the clothing worn by the person in the original image with the garment from the reference image.

Strictly preserve:
    •    the model's identity (face and body)
    •    exact pose
    •    original lighting
    •    camera angle and framing
    •    original background

Fit the new garment naturally onto the model's body, ensuring:
    •    correct anatomy and proportions
    •    realistic fabric folds and tension
    •    proper draping according to the pose

The garment must:
    •    retain its original color, texture, and design
    •    not be altered or stylized
    •    match the perspective of the scene

Output a photorealistic, high-detail fashion catalog image with consistent lighting and no visual artifacts.`;
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