import {
  AspectRatio,
  Provider,
  Role,
  CatalogEntityStatus,
} from './types';

export const ROLE_VALUES: Role[] = ['admin', 'operador', 'revisor'];
export const PROVIDER_VALUES: Provider[] = ['fal-seedream', 'fal-banana-pro', 'openai-gpt-image-1.5'];
export const ASPECT_RATIO_VALUES: AspectRatio[] = ['9:16', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9'];

export const PROVIDER_LABELS: Record<Provider, string> = {
  'fal-seedream': 'fal.ai seedream',
  'fal-banana-pro': 'fal.ai banana-pro',
  'openai-gpt-image-1.5': 'OpenAI gpt-image-1.5',
};

export const DEFAULT_TRY_ON_PROMPT =
  `Replace only the clothing worn by the person in the original image with the garment from the reference image.

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

export const isRole = (value: unknown): value is Role => ROLE_VALUES.includes(value as Role);
export const isProvider = (value: unknown): value is Provider => PROVIDER_VALUES.includes(value as Provider);
export const isAspectRatio = (value: unknown): value is AspectRatio => ASPECT_RATIO_VALUES.includes(value as AspectRatio);
export const isCatalogEntityStatus = (value: unknown): value is CatalogEntityStatus =>
  value === 'active' || value === 'archived';
export const isArchivedCatalogEntity = (value: { status?: CatalogEntityStatus | null } | null | undefined): boolean =>
  value?.status === 'archived';
export const isActiveCatalogEntity = (value: { status?: CatalogEntityStatus | null } | null | undefined): boolean =>
  !isArchivedCatalogEntity(value);
export const buildFinalGenerationPrompt = (promptBase: string, garmentIsMultiAngle: boolean): string => {
  const basePrompt = promptBase.trim() || DEFAULT_TRY_ON_PROMPT;
  const sections = [basePrompt];

  if (garmentIsMultiAngle) {
    sections.push('La prenda de referencia esta mostrada desde multiples angulos dentro de una sola imagen.');
  }

  return sections.filter(Boolean).join('\n\n');
};
