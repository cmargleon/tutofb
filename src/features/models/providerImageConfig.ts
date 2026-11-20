import { createDefaultProviderImageConfig, resolveAspectRatioForImageConfig } from '../../../shared/src/providerImageConfig';
import sharedDomain from '../../../shared/src/domain';
import { AspectRatio, Provider, ProviderImageConfig } from '../../../shared/src/types';

export const mapModelPhotoProviderToProvider = sharedDomain.mapModelPhotoProviderToProvider;

export const createDefaultModelProviderImageConfigs = (): Record<Provider, ProviderImageConfig> => ({
  'fal-seedream': createDefaultProviderImageConfig('fal-seedream'),
  'fal-banana-pro': createDefaultProviderImageConfig('fal-banana-pro'),
  'openai-gpt-image-1.5': createDefaultProviderImageConfig('openai-gpt-image-1.5'),
  'fal-nano-banana-2': createDefaultProviderImageConfig('fal-nano-banana-2'),
  'fal-seedream-5': createDefaultProviderImageConfig('fal-seedream-5'),
  'fal-gpt-image-2': createDefaultProviderImageConfig('fal-gpt-image-2'),
  'fal-gpt-image-2.5-sunburst': createDefaultProviderImageConfig('fal-gpt-image-2.5-sunburst'),
  'fal-gpt-image-2.5-flare': createDefaultProviderImageConfig('fal-gpt-image-2.5-flare'),
  'fal-seedream-5-pro': createDefaultProviderImageConfig('fal-seedream-5-pro'),
  'fal-seedream-5-flash': createDefaultProviderImageConfig('fal-seedream-5-flash'),
  'fal-flux-2-edit': createDefaultProviderImageConfig('fal-flux-2-edit'),
});

export const resolveModelAspectRatioForImageConfig = (config: ProviderImageConfig): AspectRatio =>
  resolveAspectRatioForImageConfig(config);
