/** One vocabulary for marketplace base generation, visual verification and UI. Identity backgrounds are independent. */
export const MODEL_NEUTRAL_TONES = ['light_gray', 'medium_gray', 'warm_beige', 'cool_sand', 'off_white'] as const;
export type ModelNeutralTone = typeof MODEL_NEUTRAL_TONES[number];
export const MODEL_BACKGROUNDS = {
  white: { label: 'Blanco puro', prompt: 'Pure white RGB 255,255,255 seamless background, including the entire perimeter.' },
  neutral: { label: 'Neutro genérico', prompt: 'Quiet real neutral light studio background with natural shadows.' },
  light_gray: { label: 'Gris claro neutro', prompt: 'Light gray neutral seamless paper backdrop, visibly gray rather than white, with natural soft shadows.' },
  medium_gray: { label: 'Gris medio neutro', prompt: 'Medium gray neutral seamless studio backdrop, visibly darker than light gray, with natural soft shadows.' },
  warm_beige: { label: 'Beige cálido neutro', prompt: 'Warm beige neutral seamless backdrop with a subtle warm cream-brown tone and natural soft shadows.' },
  cool_sand: { label: 'Arena fría neutra', prompt: 'Cool sand-toned neutral seamless backdrop with a muted cool gray-beige tone and natural soft shadows.' },
  off_white: { label: 'Blanco roto neutro', prompt: 'Soft off-white neutral seamless backdrop, visibly tinted cream rather than pure white RGB 255,255,255, with natural soft shadows.' },
} as const;
export function modelBackground(spec: { background: 'white' | 'neutral'; backgroundTone?: ModelNeutralTone }) {
  return MODEL_BACKGROUNDS[spec.background === 'neutral' ? spec.backgroundTone ?? 'neutral' : 'white'];
}
export const MODEL_BASE_BACKGROUND_REPLACEMENT = 'Use the identity reference only for the person, age and body proportions, never for the scene. Ignore and completely replace the identity reference background, even if it is white. The configured marketplace and role background below is mandatory and overrides the reference background and any pose recipe background wording.';
export const MODEL_DRESSING_BACKGROUND = 'The FIRST image is the approved base and is the only background reference. Ignore backgrounds in garment and identity references; replace them with the approved base background. Preserve its exact tone, scene and shadows.';
export function modelBackgroundVerification(spec: { background: 'white' | 'neutral'; backgroundTone?: ModelNeutralTone }, report: 'observation' | 'review' = 'observation') {
  const reporting = report === 'observation'
    ? 'Report the observed category (white, neutral, context), approximate backgroundTone (white, neutral, light_gray, medium_gray, warm_beige, cool_sand, off_white, context, unknown), backgroundMatches and visible backgroundEvidence.'
    : 'Include a background criterion in the review: state the observed category and approximate tone, explain visible evidence in its reason, and reject if it does not match.';
  return `Expected background: ${modelBackground(spec).prompt} Evaluate only the last/result image against this requirement, never against the identity background. ${reporting} Pure white is not light gray or off-white. Allow natural lighting and shadows, but not a different backdrop tone. Do not infer compliance from the requested configuration.`;
}
