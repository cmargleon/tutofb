import { MODEL_POSE_RECIPES } from './constants';
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
  [
    'Use the reference image as the exact same model identity.',
    'Preserve the same face, hair, skin tone, body proportions, age, and overall appearance.',
    'Change only the pose and camera angle while keeping the same plain replaceable clothing and studio style.',
    basePrompt,
    `Update the pose to: ${shotType}.`,
  ].join(' ');

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
  [
    'Use the reference image as the exact same chosen model identity.',
    'Preserve the same face, hair, skin tone, body proportions, clothing, background, and lighting from the chosen candidate.',
    'Change only the pose and camera angle.',
    basePrompt,
    `Update the pose to: ${shotType}.`,
  ].join(' ');
