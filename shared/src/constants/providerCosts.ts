import type {
  FalBananaProImageConfig,
  FalGPTImage2ImageConfig,
  FalNanoBanana2ImageConfig,
  ModelPhotoProvider,
  OpenAIImageConfig,
  Provider,
  ProviderImageConfig,
  Seedream5ImageSizePreset,
  SeedreamImageSizePreset,
} from '../types';

export const PROVIDER_COSTS: Record<Provider, number> = {
  'fal-seedream': 0.04,
  'fal-banana-pro': 0.15,
  'openai-gpt-image-1.5': 0.04,
  'fal-nano-banana-2': 0.08,
  'fal-seedream-5': 0.035,
  'fal-gpt-image-2': 0.04,
};

export const PROVIDER_PRICE_LABELS: Record<Provider, string> = {
  'fal-seedream': '$0.04/img',
  'fal-banana-pro': '$0.15/img base, $0.30 en 4K',
  'openai-gpt-image-1.5': '$0.02-$0.25/img segun quality y size',
  'fal-nano-banana-2': '$0.06-$0.16/img segun resolucion',
  'fal-seedream-5': '$0.035/img',
  'fal-gpt-image-2': '$0.01-$0.41/img segun quality y tamano',
};

export const MODEL_PHOTO_PROVIDER_COSTS: Record<ModelPhotoProvider, number> = {
  'fal-seedream-v4.5': 0.04,
  'fal-banana-pro': 0.15,
  'openai-dalle': 0.04,
  'fal-nano-banana-2': 0.08,
  'fal-seedream-5': 0.035,
  'fal-gpt-image-2': 0.04,
};

export const MODEL_PHOTO_PROVIDER_PRICE_LABELS: Record<ModelPhotoProvider, string> = {
  'fal-seedream-v4.5': '$0.04/foto',
  'fal-banana-pro': '$0.15/foto base, $0.30 en 4K',
  'openai-dalle': '$0.02-$0.25/foto segun quality y size',
  'fal-nano-banana-2': '$0.06-$0.16/foto segun resolucion',
  'fal-seedream-5': '$0.035/foto',
  'fal-gpt-image-2': '$0.01-$0.41/foto segun quality y tamano',
};

const SEEDREAM_V45_PRESET_COSTS: Partial<Record<SeedreamImageSizePreset, number>> = {
  auto_2K: 0.04,
  auto_4K: 0.04,
};

const SEEDREAM_5_PRESET_COSTS: Partial<Record<Seedream5ImageSizePreset, number>> = {
  auto_2K: 0.035,
  auto_3K: 0.035,
};

const OPENAI_IMAGE_COSTS: Record<OpenAIImageConfig['quality'], Record<OpenAIImageConfig['size'], number>> = {
  low: {
    '1024x1024': 0.02,
    '1024x1536': 0.03,
    '1536x1024': 0.03,
  },
  medium: {
    '1024x1024': 0.04,
    '1024x1536': 0.06,
    '1536x1024': 0.06,
  },
  high: {
    '1024x1024': 0.17,
    '1024x1536': 0.25,
    '1536x1024': 0.25,
  },
};

const GPT_IMAGE_2_COSTS: Record<
  Exclude<FalGPTImage2ImageConfig['quality'], 'auto'>,
  Record<Exclude<FalGPTImage2ImageConfig['imageSize'], { width: number; height: number }> | 'custom', number>
> = {
  low: {
    square_hd: 0.01,
    square: 0.01,
    portrait_4_3: 0.01,
    portrait_16_9: 0.01,
    landscape_4_3: 0.01,
    landscape_16_9: 0.01,
    auto: 0.01,
    custom: 0.01,
  },
  medium: {
    square_hd: 0.06,
    square: 0.04,
    portrait_4_3: 0.04,
    portrait_16_9: 0.04,
    landscape_4_3: 0.04,
    landscape_16_9: 0.04,
    auto: 0.04,
    custom: 0.06,
  },
  high: {
    square_hd: 0.22,
    square: 0.15,
    portrait_4_3: 0.15,
    portrait_16_9: 0.15,
    landscape_4_3: 0.15,
    landscape_16_9: 0.15,
    auto: 0.15,
    custom: 0.22,
  },
};

const getSeedreamV45Cost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'fal-seedream') return PROVIDER_COSTS['fal-seedream'];
  if (typeof imageConfig.imageSize === 'string') {
    return SEEDREAM_V45_PRESET_COSTS[imageConfig.imageSize] ?? PROVIDER_COSTS['fal-seedream'];
  }
  return PROVIDER_COSTS['fal-seedream'];
};

const getBananaProCost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'fal-banana-pro') return PROVIDER_COSTS['fal-banana-pro'];

  const config = imageConfig as FalBananaProImageConfig;
  switch (config.resolution) {
    case '4K':
      return 0.3;
    case '1K':
    case '2K':
    default:
      return PROVIDER_COSTS['fal-banana-pro'];
  }
};

const getOpenAICost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'openai-gpt-image-1.5') return PROVIDER_COSTS['openai-gpt-image-1.5'];
  return OPENAI_IMAGE_COSTS[imageConfig.quality][imageConfig.size];
};

const getNanoBanana2Cost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'fal-nano-banana-2') return PROVIDER_COSTS['fal-nano-banana-2'];

  const config = imageConfig as FalNanoBanana2ImageConfig;
  switch (config.resolution) {
    case '0.5K':
      return 0.06;
    case '2K':
      return 0.12;
    case '4K':
      return 0.16;
    case '1K':
    default:
      return PROVIDER_COSTS['fal-nano-banana-2'];
  }
};

const getSeedream5Cost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'fal-seedream-5') return PROVIDER_COSTS['fal-seedream-5'];
  if (typeof imageConfig.imageSize === 'string') {
    return SEEDREAM_5_PRESET_COSTS[imageConfig.imageSize] ?? PROVIDER_COSTS['fal-seedream-5'];
  }
  return PROVIDER_COSTS['fal-seedream-5'];
};

const getGPTImage2Cost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'fal-gpt-image-2') return PROVIDER_COSTS['fal-gpt-image-2'];
  const quality = imageConfig.quality === 'auto' ? 'medium' : imageConfig.quality;
  const sizeKey = typeof imageConfig.imageSize === 'string' ? imageConfig.imageSize : 'custom';
  return GPT_IMAGE_2_COSTS[quality][sizeKey] ?? PROVIDER_COSTS['fal-gpt-image-2'];
};

export const getProviderCostUsd = (provider: Provider, imageConfig?: ProviderImageConfig | null): number => {
  switch (provider) {
    case 'fal-seedream':
      return getSeedreamV45Cost(imageConfig);
    case 'fal-banana-pro':
      return getBananaProCost(imageConfig);
    case 'openai-gpt-image-1.5':
      return getOpenAICost(imageConfig);
    case 'fal-nano-banana-2':
      return getNanoBanana2Cost(imageConfig);
    case 'fal-seedream-5':
      return getSeedream5Cost(imageConfig);
    case 'fal-gpt-image-2':
      return getGPTImage2Cost(imageConfig);
    default:
      return 0;
  }
};

export const getModelPhotoProviderCostUsd = (
  provider: ModelPhotoProvider,
  imageConfig?: ProviderImageConfig | null,
): number => {
  switch (provider) {
    case 'fal-seedream-v4.5':
      return getSeedreamV45Cost(imageConfig);
    case 'fal-banana-pro':
      return getBananaProCost(imageConfig);
    case 'openai-dalle':
      return getOpenAICost(imageConfig);
    case 'fal-nano-banana-2':
      return getNanoBanana2Cost(imageConfig);
    case 'fal-seedream-5':
      return getSeedream5Cost(imageConfig);
    case 'fal-gpt-image-2':
      return getGPTImage2Cost(imageConfig);
    default:
      return 0;
  }
};
