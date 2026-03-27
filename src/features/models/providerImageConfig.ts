import { createDefaultProviderImageConfig, resolveAspectRatioForImageConfig } from '../../../shared/src/providerImageConfig';
import { AspectRatio, ModelPhotoProvider, Provider, ProviderImageConfig } from '../../../shared/src/types';

const MODEL_PROVIDER_TO_PROVIDER: Record<ModelPhotoProvider, Provider> = {
  'fal-seedream-v4.5': 'fal-seedream',
  'fal-banana-pro': 'fal-banana-pro',
  'openai-dalle': 'openai-gpt-image-1.5',
};

export const mapModelPhotoProviderToProvider = (provider: ModelPhotoProvider): Provider =>
  MODEL_PROVIDER_TO_PROVIDER[provider];

export const createDefaultModelProviderImageConfigs = (): Record<Provider, ProviderImageConfig> => ({
  'fal-seedream': createDefaultProviderImageConfig('fal-seedream'),
  'fal-banana-pro': createDefaultProviderImageConfig('fal-banana-pro'),
  'openai-gpt-image-1.5': createDefaultProviderImageConfig('openai-gpt-image-1.5'),
});

export const resolveModelAspectRatioForImageConfig = (config: ProviderImageConfig): AspectRatio =>
  resolveAspectRatioForImageConfig(config);
