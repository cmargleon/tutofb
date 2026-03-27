import { Provider, ModelPhotoProvider } from '../types';

export const PROVIDER_COSTS: Record<Provider, number> = {
  'fal-seedream': 0.03,
  'fal-banana-pro': 0.15,
  'openai-gpt-image-1.5': 0.04,
};

// Estimated cost per generated model photo (text-to-image)
export const MODEL_PHOTO_PROVIDER_COSTS: Record<ModelPhotoProvider, number> = {
  'fal-seedream-v4.5': 0.04,
  'fal-banana-pro': 0.04,
  'openai-dalle': 0.04,
};
