import { Provider, ModelPhotoProvider } from '../types';

export const PROVIDER_COSTS: Record<Provider, number> = {
  'fal-seedream': 0.03,
  'fal-banana-pro': 0.15,
  'openai-gpt-image-1.5': 0.04,
};

// Estimated cost per generated model photo (text-to-image)
export const MODEL_PHOTO_PROVIDER_COSTS: Record<ModelPhotoProvider, number> = {
  'fal-flux-pro': 0.055,
  'fal-flux-schnell': 0.003,
  'fal-seedream-v4': 0.03,
  'fal-seedream-v4.5': 0.04,
  'fal-banana': 0.02,
  'fal-banana-pro': 0.04,
  'fal-banana-2': 0.02,
  'openai-dalle': 0.04,
};
