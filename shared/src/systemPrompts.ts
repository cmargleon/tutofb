import { buildModelIdentityPromptBlock, CARRY_ACCESSORY_PROMPT_BLOCK, DEFAULT_TRY_ON_PROMPT_CASES, INTERNAL_GARMENT_DETAILS_PROMPT_BLOCK } from './domain';
import { DEFAULT_PRODUCT_PROMPT, PRODUCT_SCENES } from './productGeneration';
import type { SystemConfig } from './types';

export const ADDITIONAL_SYSTEM_PROMPT_FIELDS = [
  { key: 'systemPromptIdentity', label: 'Conservación de identidad de la modelo', defaultValue: buildModelIdentityPromptBlock(), maxLength: 30000 },
  { key: 'systemPromptInternalLabels', label: 'Tratamiento de etiquetas interiores', defaultValue: INTERNAL_GARMENT_DETAILS_PROMPT_BLOCK, maxLength: 30000 },
  { key: 'systemPromptCarryAccessory', label: 'Caso D: accesorio transportable', defaultValue: DEFAULT_TRY_ON_PROMPT_CASES.carry_accessory, maxLength: 30000 },
  { key: 'systemPromptAccessories', label: 'Reglas de accesorios', defaultValue: CARRY_ACCESSORY_PROMPT_BLOCK, maxLength: 30000 },
  { key: 'systemPromptProduct', label: 'Instrucciones generales de fotografía de producto', defaultValue: DEFAULT_PRODUCT_PROMPT, maxLength: 8000 },
] as const;

export type AdditionalSystemPromptKey = typeof ADDITIONAL_SYSTEM_PROMPT_FIELDS[number]['key'];
export type AdditionalSystemPrompts = Pick<SystemConfig, AdditionalSystemPromptKey | 'systemProductScenePrompts'>;

// Null means use the internal default, as with the existing global prompts.
const normalizeOverride = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const normalizeAdditionalSystemPrompts = (input?: Partial<SystemConfig> | null): AdditionalSystemPrompts => {
  const prompts = Object.fromEntries(ADDITIONAL_SYSTEM_PROMPT_FIELDS.map(({ key, defaultValue }) => {
    const value = normalizeOverride(input?.[key]);
    return [key, value === defaultValue.trim() ? null : value];
  })) as Pick<SystemConfig, AdditionalSystemPromptKey>;
  const scenes = Object.fromEntries(PRODUCT_SCENES.flatMap(({ type, prompt }) => {
    const value = normalizeOverride(input?.systemProductScenePrompts?.[type]);
    return value && value !== prompt.trim() ? [[type, value]] : [];
  }));
  return { ...prompts, systemProductScenePrompts: Object.keys(scenes).length ? scenes : null };
};
