import type { AspectRatio, Provider, ProviderImageConfig } from './types';
import { cloneProviderImageConfig, createDefaultProviderImageConfig, isProviderImageConfig, resolveAspectRatioForImageConfig } from './providerImageConfig';

/** Only persisted opt-in documents use this policy. Absence always means legacy. */
export const COMMERCIAL_PHOTO_PROFILE = 'commercial-photo-v1' as const;
export const COMMERCIAL_PHOTO_STORAGE = {
  maxSide: 2048, maxBytes: 2_800_000, contentType: 'image/jpeg', extension: 'jpg',
  colourSpace: 'srgb', depth: 'uchar', qualities: [90, 88, 85, 82, 80],
} as const;

// Exact edit endpoints checked against fal OpenAPI on 2026-11-09. Keep the
// narrower local validation envelope; these defaults do not widen explicit inputs.
export const COMMERCIAL_PHOTO_CAPABILITIES = {
  'fal-gpt-image-2.5-flare': { sizing: 'custom', multiple: 16, minArea: 655360, maxArea: 8294400, maxSide: 3840, formats: ['jpeg', 'png', 'webp'] },
  'fal-gpt-image-2.5-sunburst': { sizing: 'custom', multiple: 16, minArea: 655360, maxArea: 8294400, maxSide: 3840, formats: ['jpeg', 'png', 'webp'] },
  'fal-gpt-image-2': { sizing: 'custom', multiple: 16, minArea: 655360, maxArea: 8294400, maxSide: 3840, formats: ['jpeg', 'png', 'webp'] },
  'fal-seedream-5-pro': { sizing: 'custom', multiple: 1, minArea: 1048576, maxArea: 4194304, maxSide: 4096, formats: ['jpeg', 'png'] },
  'fal-seedream-5-flash': { sizing: 'custom', multiple: 1, minArea: 1048576, maxArea: 4194304, maxSide: 4096, formats: ['jpeg', 'png'] },
  'fal-flux-2-edit': { sizing: 'custom', multiple: 1, minArea: 512 * 512, maxArea: 4194304, maxSide: 2048, formats: ['jpeg', 'png', 'webp'] },
  'fal-seedream': { sizing: 'custom', multiple: 1, minArea: 2560 * 1440, maxArea: 4096 * 4096, maxSide: 4096, formats: [] },
  'fal-seedream-5': { sizing: 'custom', multiple: 1, minArea: 2560 * 1440, maxArea: 4096 * 4096, maxSide: 4096, formats: ['jpeg', 'png'] },
  'fal-banana-pro': { sizing: 'native', multiple: 1, minArea: 0, maxArea: 0, maxSide: 0, formats: ['jpeg', 'png', 'webp'] },
  'fal-nano-banana-2': { sizing: 'native', multiple: 1, minArea: 0, maxArea: 0, maxSide: 0, formats: ['jpeg', 'png', 'webp'] },
} as const;

export const commercialPhotoSize = (provider: Exclude<Provider, 'openai-gpt-image-1.5'>, ratio: AspectRatio) => {
  const [w, h] = ratio.split(':').map(Number);
  const capability = COMMERCIAL_PHOTO_CAPABILITIES[provider];
  // Choose a common multiplier of the reduced ratio, never round each axis.
  const step = capability.multiple;
  let k = Math.floor(COMMERCIAL_PHOTO_STORAGE.maxSide / Math.max(w, h) / step) * step;
  if (w * h * k * k < capability.minArea) k = Math.ceil(Math.sqrt(capability.minArea / (w * h)) / step) * step;
  return { width: w * k, height: h * k };
};

export const createCommercialProviderImageConfig = (provider: Provider, ratio: AspectRatio = '3:4'): ProviderImageConfig => {
  if (provider === 'openai-gpt-image-1.5') return createDefaultProviderImageConfig(provider); // retired; no new capabilities
  if (provider === 'fal-banana-pro' || provider === 'fal-nano-banana-2') {
    // Native 2K is a tier, not a 2048-pixel bound; measure the returned bytes.
    return { provider, aspectRatio: ratio, resolution: '2K', outputFormat: 'jpeg' };
  }
  const imageSize = commercialPhotoSize(provider, ratio);
  if (provider === 'fal-gpt-image-2' || provider === 'fal-gpt-image-2.5-flare' || provider === 'fal-gpt-image-2.5-sunburst') {
    return { provider, imageSize, quality: 'medium', outputFormat: 'jpeg' };
  }
  if (provider === 'fal-seedream') return { provider, imageSize }; // no output_format in this endpoint
  return { provider, imageSize, outputFormat: 'jpeg' };
};

/** Request > compatible client preset > commercial default. Explicit auto stays auto. */
export const resolveCommercialPhotoConfig = (
  provider: Provider, requested?: unknown, ratio?: AspectRatio | null, preset?: ProviderImageConfig | null,
): { imageConfig: ProviderImageConfig; aspectRatio: AspectRatio } => {
  const explicit = isProviderImageConfig(requested) && requested.provider === provider ? requested
    : preset?.provider === provider && isProviderImageConfig(preset) ? preset : null;
  const imageConfig = explicit ? cloneProviderImageConfig(explicit) : createCommercialProviderImageConfig(provider, ratio || '3:4');
  return { imageConfig, aspectRatio: resolveAspectRatioForImageConfig(imageConfig) };
};
