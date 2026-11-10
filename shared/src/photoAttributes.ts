import type { PhotoArticleAttributes, PhotoAttribute } from './types/photoPlan';
export const PHOTO_ATTRIBUTE_VALUES = {
  category: ['ordinary', 'underwear', 'swimwear', 'bodysuit', 'fitted_child', 'accessory', 'object'],
  audience: ['baby', 'child', 'adult'], bodyArea: ['upper_body', 'lower_body', 'full_body', 'footwear', 'head_accessory', 'carry_accessory'],
  gender: ['male', 'female', 'unisex'], packaging: ['unit', 'set', 'multipack'],
} as const;
export function normalizePhotoAttributes(input: unknown, allowCorrections = false): Partial<PhotoArticleAttributes> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, PhotoAttribute<unknown>> = {};
  for (const key of [...Object.keys(PHOTO_ATTRIBUTE_VALUES), 'transparency', 'components', 'color']) {
    const raw = (input as Record<string, any>)[key];
    if (!raw || typeof raw !== 'object') continue;
    const allowed = PHOTO_ATTRIBUTE_VALUES[key as keyof typeof PHOTO_ATTRIBUTE_VALUES] as readonly unknown[] | undefined;
    const valid = allowed ? allowed.includes(raw.value) : key === 'transparency' ? typeof raw.value === 'boolean' : typeof raw.value === 'string' && raw.value.length <= 500;
    result[key] = { value: valid ? raw.value : null, confidence: typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : null,
      evidence: typeof raw.evidence === 'string' ? raw.evidence.slice(0, 1000) : '', source: allowCorrections && ['manual', 'commercial'].includes(raw.source) ? raw.source : 'gemini' };
  }
  return result as Partial<PhotoArticleAttributes>;
}
export function mergePhotoAttributes(inferred: Partial<PhotoArticleAttributes> = {}, explicit: Partial<PhotoArticleAttributes> = {}): Partial<PhotoArticleAttributes> {
  return { ...inferred, ...Object.fromEntries(Object.entries(explicit).filter(([, a]) => a.source === 'manual' || a.source === 'commercial')) };
}

/** Declared model age is commercial identity data; visual appearance cannot make a declared minor adult. */
export function withDeclaredModelAge(observation: import('./types').PhotoBaseObservation, traits?: import('./types').ModelIdentityTraits | null): import('./types').PhotoBaseObservation {
  const match = traits?.age?.match(/^\s*(\d{1,2})(?:\s*(?:años|years?))?\s*$/i);
  if (!match) return observation;
  const age = Number(match[1]);
  return { ...observation, audience: age < 2 ? 'baby' : age < 18 ? 'child' : 'adult', evidence: `${observation.evidence} Edad declarada del modelo: ${age}; prevalece sobre la inferencia visual de público.` };
}
