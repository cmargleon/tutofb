import type { ProductSceneInput } from './types/productGeneration';

export const PRODUCT_IDENTITY_RULES = 'Preserve the exact referenced product: shape, geometry, proportions, colors, materials, logos, lettering, prints and every physical part. Do not redesign, add or remove pieces. References show the same product, not a person or pose. Photorealistic commercial product photography, no invented branding or text.';
export const DEFAULT_PRODUCT_PROMPT = 'Photorealistic commercial product photography. Keep the product clearly visible, with realistic lighting and detailed materials.';
export const PRODUCT_SCENES = [
  { type: 'clean', label: 'Lifestyle · entorno natural', prompt: 'One product in an appropriate real everyday setting on a contextual surface, soft natural light and realistic shadows. Include visible environmental context, not a plain white seamless or studio background. No people. Product remains clearly visible.' },
  { type: 'lifestyle_1', label: 'Ambiente cotidiano', prompt: 'One product in a realistic appropriate everyday environment, natural daylight. No people. Product remains clearly visible.' },
  { type: 'lifestyle_2', label: 'Segundo contexto de uso', prompt: 'One product in a different realistic use-context, warm interior lighting. No people. Do not invent functionality or attachments.' },
  { type: 'hero', label: 'Lifestyle · composición ambiental', prompt: 'One product as the hero of an elegant realistic lifestyle setting, contextual surroundings, detailed materials and soft ambient lighting. Use a different setting and composition from the other lifestyle views, not a plain white seamless or studio background. No people. Product remains clearly visible.' },
  { type: 'human_use_1', label: 'Persona usando el producto', prompt: 'A person naturally using the exact referenced product for its intended purpose. Show a clear, believable interaction, not simply posing beside it. Use a relatively neutral, uncluttered background in muted tones. Keep the product prominent and clearly visible, with natural lighting and anatomically correct hands and body. Do not invent functionality or attachments.' },
  { type: 'human_use_2', label: 'Persona usando el producto · otra vista', prompt: 'A person naturally using the exact referenced product for its intended purpose, with a different framing and viewpoint from the first human-use scene. Show a clear, believable interaction, not simply posing beside it. Use a relatively neutral, uncluttered background in muted tones. Keep the product prominent and clearly visible, with soft realistic lighting and anatomically correct hands and body. Do not invent functionality or attachments.' },
] as const;

export const createDefaultProductScenes = (): ProductSceneInput[] => PRODUCT_SCENES.map(({ type, prompt }) => ({ type, prompt }));
export const buildProductSceneInstructions = (general: string, scene: string): string => [general.trim(), scene.trim()].filter(Boolean).join('\n');
export const buildProductPrompt = (general: string, scene: string): string => [PRODUCT_IDENTITY_RULES, buildProductSceneInstructions(general, scene)].filter(Boolean).join('\n');
