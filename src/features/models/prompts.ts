import { MODEL_POSE_RECIPES } from './constants';
import type {
  PosePromptCategory,
  PosePromptModifier,
  PosePromptOrientation,
  PoseRecipe,
} from './types';
import {
  ReferenceBackgroundMode,
  ReferenceClothingMode,
  ReferenceIdentityMode,
} from './types';

export const buildIdentityPrompt = (params: {
  sex: string; age: string; skin: string;
  hairColor: string; hairLength: string; build: string;
  background: string; bokeh: number;
  top: string; bottom: string; footwear: string;
}): string => {
  const isDescriptiveAge = params.age.includes(',');
  const ageText = isDescriptiveAge
    ? params.age
    : params.age === '65+' ? 'over 65 years old' : `${params.age} years old`;

  const clothingParts = [params.top, params.bottom, params.footwear].filter(Boolean);
  const clothingText = clothingParts.length > 0
    ? `Wearing ${clothingParts.join(', ')}.`
    : 'Minimal plain clothing.';

  const bokehText = params.bokeh === 0
    ? 'Sharp, in-focus background.'
    : params.bokeh <= 30
    ? `Subtle bokeh blur on background (${params.bokeh}% intensity), subject sharp.`
    : params.bokeh <= 60
    ? `Moderate bokeh blur on background (${params.bokeh}% intensity), subject in sharp focus.`
    : `Strong bokeh blur on background (${params.bokeh}% intensity), subject in crisp sharp focus, shallow depth of field.`;

  return [
    `Professional fashion catalog photo.`,
    `A ${ageText} ${params.sex} with ${params.skin} skin tone,`,
    `${params.hairLength} ${params.hairColor} hair, ${params.build} build.`,
    clothingText,
    `Clothing is plain, solid color, no patterns or prints, easy to digitally replace.`,
    `${MODEL_POSE_RECIPES[0].shotType}.`,
    `${params.background}.`,
    bokehText,
    `Photorealistic, professional catalog lighting, no text or watermarks.`,
  ].join(' ');
};

export const buildPosePrompt = (basePrompt: string, shotType: string): string =>
  buildPosePromptFromRecipe(basePrompt, { shotType });

export const buildReferencePoseBasePrompt = (params: {
  identityMode: ReferenceIdentityMode;
  backgroundMode: ReferenceBackgroundMode;
  backgroundPrompt: string;
  clothingMode: ReferenceClothingMode;
  clothingPrompt: string;
}): string => {
  const identityInstructions =
    params.identityMode === 'exact'
      ? [
          'Use the reference image as the exact same model identity.',
          'Preserve the same face, hair, skin tone, body proportions, age, and distinctive traits.',
        ]
      : [
          'Use the reference image only as inspiration for a similar model identity.',
          'Create a similar person with comparable age range, body type, styling, and overall vibe, but not an identical face.',
        ];

  const backgroundInstructions =
    params.backgroundMode === 'preserve'
      ? [
          'Keep the same background, floor, lighting direction, and studio context whenever possible.',
        ]
      : params.backgroundPrompt.trim()
      ? [`Update the background to: ${params.backgroundPrompt.trim()}.`]
      : ['The background can change if needed, but keep the image production-ready.'];

  const clothingInstructions =
    params.clothingMode === 'preserve'
      ? ['Keep the same clothing and styling from the reference image.']
      : params.clothingPrompt.trim()
      ? [`Update the clothing to: ${params.clothingPrompt.trim()}.`]
      : ['The clothing can change, but keep it plain, solid, and easy to replace digitally.'];

  return [
    ...identityInstructions,
    ...clothingInstructions,
    ...backgroundInstructions,
    'Photorealistic fashion catalog image, professional lighting, no text or watermarks.',
  ].join(' ');
};

export const buildReferenceCandidatePrompt = (basePrompt: string): string =>
  [
    basePrompt,
    'Keep a full-body front-facing standing pose suitable for choosing a base model candidate.',
    'Return a polished catalog-ready image.',
  ].join(' ');

export const buildReferencePosePrompt = (basePrompt: string, shotType: string): string =>
  buildReferencePosePromptFromRecipe(basePrompt, { shotType });

const CATEGORY_PROMPT_RULES: Record<PosePromptCategory, string[]> = {
  full_body: [
    'Frame the full body from head to full feet with the entire silhouette clearly readable.',
    'Keep both feet fully visible inside the frame and do not crop hands, head, or shoes.',
    'The full outfit must stay readable without limbs or perspective hiding key garment areas.',
    'Prioritize clean catalog readability over dramatic editorial styling.',
  ],
  half_body: [
    'Frame the subject from around the head and shoulders down to the waist or upper hips.',
    'Keep the torso as the dominant part of the composition and do not show full legs.',
    'Do not let arms, hair, or pose block the main garment area on the torso.',
    'The body angle must remain clear and commercially readable.',
  ],
  lower_body: [
    'Frame the image strictly from the waist to the full feet, with the waistband visible and both feet completely inside the frame.',
    'Do not crop above the waist and do not crop any part of the feet, ankles, or hems.',
    'The full lower garment must be fully visible from waistband to hem.',
    'Keep both legs and the entire silhouette of the garment clearly visible.',
    'Do not show the model face or head.',
  ],
  footwear_closeup: [
    'Frame a close-up centered on the footwear from around the lower shin or ankle down to the full soles.',
    'Keep both shoes or feet completely inside the frame with clear commercial readability.',
    'The footwear must be the primary subject, large enough to inspect shape, silhouette, and upper details.',
    'Do not widen the frame into a lower-body, half-body, or full-body composition.',
    'Do not show the model face, torso, or hands.',
  ],
  portrait: [
    'Frame a tight portrait from roughly chest or shoulders upward, keeping the face as the primary subject.',
    'Keep facial features, eyes, and expression clear and commercially polished.',
    'Do not widen the frame into a half-body or full-body composition.',
    'Hair and pose must not hide the key identity features of the face.',
  ],
};

const getOrientationPromptRules = (
  category: PosePromptCategory,
  orientation: PosePromptOrientation,
): string[] => {
  switch (orientation) {
    case 'front':
      return [
        'The body must read as a true front view, not an ambiguous three-quarter turn.',
        category === 'portrait'
          ? 'Keep the face looking clearly toward the camera.'
          : 'Keep shoulders and hips aligned so the front of the look reads clearly.',
      ];
    case 'front_three_quarter':
      return [
        'Use a controlled three-quarter front turn that still reads primarily as a front-facing commercial angle.',
        'Show depth and side volume without losing the frontal read of the subject or garment.',
      ];
    case 'profile_left':
      return [
        'Use a clean left side profile with the body orientation unmistakably lateral.',
        'Avoid drifting back toward a front three-quarter angle.',
      ];
    case 'back':
      return [
        'The body must read as a true back view with no ambiguous twist back toward the camera.',
        category === 'portrait'
          ? 'Keep the back-of-head and shoulder line readable as a rear portrait.'
          : 'Keep shoulders and hips aligned so the back of the look reads clearly.',
      ];
    case 'back_three_quarter':
      return [
        'Use a controlled three-quarter back turn that still reads primarily as a back-facing commercial angle.',
        'Show rear volume and side depth without losing the back read of the subject or garment.',
      ];
    default:
      return [];
  }
};

const MODIFIER_PROMPT_RULES: Record<PosePromptModifier, string[]> = {
  walking: [
    'Add a subtle walking action with one controlled step, while keeping the silhouette readable and stable.',
    'Do not introduce motion blur or limb overlap that hides the garment.',
  ],
  contrapposto: [
    'Shift the body weight naturally onto one leg in a controlled contrapposto stance.',
    'Keep the waist, hips, and garment silhouette readable and commercially clean.',
  ],
};

const buildPoseRuleSet = (
  pose: Pick<PoseRecipe, 'shotType' | 'promptDirectives'> & Partial<Pick<PoseRecipe, 'promptProfile'>>,
): string[] => {
  const promptProfile = pose.promptProfile;
  const categoryRules = promptProfile ? CATEGORY_PROMPT_RULES[promptProfile.category] : [];
  const orientationRules = promptProfile
    ? getOrientationPromptRules(promptProfile.category, promptProfile.orientation)
    : [];
  const modifierRules = promptProfile?.modifiers?.flatMap((modifier) => MODIFIER_PROMPT_RULES[modifier] || []) || [];

  return [
    ...categoryRules,
    ...orientationRules,
    ...modifierRules,
    `Update the pose to: ${pose.shotType}.`,
    ...(pose.promptDirectives || []),
  ];
};

export const buildPosePromptFromRecipe = (
  basePrompt: string,
  pose: Pick<PoseRecipe, 'shotType' | 'promptDirectives'> & Partial<Pick<PoseRecipe, 'promptProfile'>>,
): string =>
  [
    'Use the reference image as the exact same model identity.',
    'Preserve the same face, hair, skin tone, body proportions, age, and overall appearance.',
    'Change only the pose and camera framing while keeping the same plain replaceable clothing and studio style.',
    basePrompt,
    ...buildPoseRuleSet(pose),
  ].join(' ');

export const buildReferencePosePromptFromRecipe = (
  basePrompt: string,
  pose: Pick<PoseRecipe, 'shotType' | 'promptDirectives'> & Partial<Pick<PoseRecipe, 'promptProfile'>>,
): string =>
  [
    'Use the reference image as the exact same chosen model identity.',
    'Preserve the same face, hair, skin tone, body proportions, clothing, background, and lighting from the chosen candidate.',
    'Change only the pose and camera framing.',
    basePrompt,
    ...buildPoseRuleSet(pose),
  ].join(' ');
