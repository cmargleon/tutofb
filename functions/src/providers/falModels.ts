import type { ProviderImageConfig } from '../../../shared/src/types';

export const NEW_FAL_ENDPOINTS = {
  'fal-gpt-image-2.5-sunburst': { generate: 'openai/gpt-image-2.5/sunburst/text-to-image', edit: 'openai/gpt-image-2.5/sunburst/edit', maxReferences: 16 },
  'fal-gpt-image-2.5-flare': { generate: 'openai/gpt-image-2.5/flare/text-to-image', edit: 'openai/gpt-image-2.5/flare/edit', maxReferences: 16 },
  'fal-seedream-5-pro': { generate: 'bytedance/seedream/v5/pro/text-to-image', edit: 'bytedance/seedream/v5/pro/edit', maxReferences: 10 },
  'fal-seedream-5-flash': { generate: 'bytedance/seedream/v5/flash/text-to-image', edit: 'bytedance/seedream/v5/flash/edit', maxReferences: 10 },
  // FLUX.2 uses its text-to-image sibling when a model identity has no reference yet.
  'fal-flux-2-edit': { generate: 'fal-ai/flux-2', edit: 'fal-ai/flux-2/edit', maxReferences: 4 },
} as const;

export type NewFalProvider = keyof typeof NEW_FAL_ENDPOINTS;
export type NewFalImageConfig = Extract<ProviderImageConfig, { provider: NewFalProvider }>;
export const isNewFalProvider = (provider: string): provider is NewFalProvider =>
  Object.prototype.hasOwnProperty.call(NEW_FAL_ENDPOINTS, provider);

export const buildNewFalRequest = (
  provider: NewFalProvider,
  prompt: string,
  imageConfig: NewFalImageConfig,
  referenceImageUrls: string[] = [],
): { endpointId: string; body: Record<string, unknown> } => {
  if (imageConfig.provider !== provider) throw new Error('La configuración no corresponde al modelo seleccionado.');
  const endpoints = NEW_FAL_ENDPOINTS[provider];
  if (referenceImageUrls.length > endpoints.maxReferences) {
    throw new Error(`Este modelo admite como máximo ${endpoints.maxReferences} imágenes de referencia.`);
  }
  return {
    endpointId: referenceImageUrls.length ? endpoints.edit : endpoints.generate,
    body: {
      prompt,
      image_size: imageConfig.imageSize,
      num_images: 1,
      output_format: 'outputFormat' in imageConfig ? imageConfig.outputFormat : 'png',
      ...('quality' in imageConfig ? { quality: imageConfig.quality } : { enable_safety_checker: true }),
      ...(referenceImageUrls.length ? { image_urls: referenceImageUrls } : {}),
    },
  };
};
