import {
  buildModelIdentityPromptBlock, CARRY_ACCESSORY_PROMPT_BLOCK, DEFAULT_TRY_ON_PROMPT_CASES,
  INTERNAL_GARMENT_DETAILS_PROMPT_BLOCK, resolveTryOnPromptCaseKey,
} from './domain';
import type { GarmentBodyArea, GarmentReferenceImageType, ModelIdentityTraits, SystemConfig, TryOnPromptCaseKey } from './types';
import { getModelGender } from './automationModels';

export const APPROVED_TRY_ON_PROMPT_FORMAT = 'approved-try-on-v1' as const;
export const MAX_APPROVED_TRY_ON_PROMPT_LENGTH = 30000;
export interface TryOnPromptBlocks {
  identity: string;
  modelGender?: 'male' | 'female' | null;
  gender?: string;
  internalLabels: string;
  accessories: string;
  cases: Record<TryOnPromptCaseKey, string>;
  multiAngle: string;
}
export const MULTI_ANGLE_PROMPT = 'La referencia de la prenda incluye multiples angulos. Usa esas vistas solo para reconstruir con precision la misma prenda, sin inventar detalles no visibles.';

// Only extract exact known blocks. Custom instructions remain verbatim and visible in the general field.
export const seedTryOnPrompt = (general: string, traits?: ModelIdentityTraits | null, config?: Partial<SystemConfig>) => {
  const modelGender = getModelGender({ identityTraits: traits });
  const identityLine = "- Preserve 100% the model's identity (face, body shape, skin tone, proportions)";
  const hasIdentityLine = general.includes(identityLine);
  return {
    general: general.split(INTERNAL_GARMENT_DETAILS_PROMPT_BLOCK).join('')
      .split(CARRY_ACCESSORY_PROMPT_BLOCK).join('').split(identityLine).join('').trim(),
    blocks: {
      modelGender,
      gender: (modelGender === 'male' ? config?.systemPromptMale : modelGender === 'female' ? config?.systemPromptFemale : null) ?? '',
      identity: config?.systemPromptIdentity != null
        ? buildModelIdentityPromptBlock(traits, config.systemPromptIdentity)
        : [buildModelIdentityPromptBlock(traits), ...(hasIdentityLine ? [identityLine] : [])].join('\n'),
      internalLabels: config?.systemPromptInternalLabels ?? INTERNAL_GARMENT_DETAILS_PROMPT_BLOCK,
      accessories: config?.systemPromptAccessories ?? CARRY_ACCESSORY_PROMPT_BLOCK,
      cases: {
        ...DEFAULT_TRY_ON_PROMPT_CASES,
        full_outfit: config?.systemPromptFullOutfit ?? DEFAULT_TRY_ON_PROMPT_CASES.full_outfit,
        top_only: config?.systemPromptTopOnly ?? DEFAULT_TRY_ON_PROMPT_CASES.top_only,
        bottom_only: config?.systemPromptBottomOnly ?? DEFAULT_TRY_ON_PROMPT_CASES.bottom_only,
        carry_accessory: config?.systemPromptCarryAccessory ?? DEFAULT_TRY_ON_PROMPT_CASES.carry_accessory,
      },
      multiAngle: MULTI_ANGLE_PROMPT,
    } satisfies TryOnPromptBlocks,
  };
};

export const composeApprovedTryOnPrompt = (
  general: string, blocks: TryOnPromptBlocks, bodyArea?: GarmentBodyArea | null,
  referenceType: GarmentReferenceImageType = 'single_view',
): string => {
  const caseKey = resolveTryOnPromptCaseKey(bodyArea);
  return [blocks.identity, general, blocks.gender ?? '', blocks.internalLabels,
    ...(caseKey ? [blocks.cases[caseKey]] : []),
    ...(caseKey === 'carry_accessory' ? [blocks.accessories] : []),
    ...(referenceType === 'multi_angle_composite' ? [blocks.multiAngle] : []),
  ].filter((text) => text.length > 0).join('\n\n');
};

export const validateApprovedTryOnPrompt = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_APPROVED_TRY_ON_PROMPT_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error(`El prompt completo debe contener texto válido y como máximo ${MAX_APPROVED_TRY_ON_PROMPT_LENGTH} caracteres.`);
  }
  return value; // Validation must never normalize the approved text.
};
