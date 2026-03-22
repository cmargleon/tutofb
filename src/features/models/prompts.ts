import { MODEL_POSE_RECIPES } from './constants';

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
