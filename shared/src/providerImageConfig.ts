import {
  AspectRatio,
  BananaAspectRatio,
  BananaResolution,
  FalBananaProImageConfig,
  FalGPTImage2ImageConfig,
  FalGPTImage25ImageConfig,
  FalSeedream5StandardImageConfig,
  FalFlux2ImageConfig,
  FalNanoBanana2ImageConfig,
  FalSeedream5ImageConfig,
  FalSeedreamImageConfig,
  GPTImage2ImageSizePreset,
  GPTImage2OutputFormat,
  GPTImage2Quality,
  NanoBanana2AspectRatio,
  NanoBanana2Resolution,
  OpenAIImageConfig,
  OpenAIImageQuality,
  OpenAIImageSize,
  Provider,
  ProviderImageConfig,
  Seedream5ImageSizePreset,
  SeedreamCustomImageSize,
  SeedreamImageSizePreset,
} from './types';

export const OPENAI_IMAGE_SIZE_VALUES: OpenAIImageSize[] = ['1024x1024', '1024x1536', '1536x1024'];
export const OPENAI_IMAGE_QUALITY_VALUES: OpenAIImageQuality[] = ['low', 'medium', 'high'];
export const GPT_IMAGE_2_IMAGE_SIZE_PRESET_VALUES: GPTImage2ImageSizePreset[] = [
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
  'auto',
];
export const GPT_IMAGE_2_QUALITY_VALUES: GPTImage2Quality[] = ['auto', 'low', 'medium', 'high'];
export const GPT_IMAGE_2_OUTPUT_FORMAT_VALUES: GPTImage2OutputFormat[] = ['png', 'jpeg', 'webp'];
export const BANANA_ASPECT_RATIO_VALUES: BananaAspectRatio[] = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];
export const BANANA_RESOLUTION_VALUES: BananaResolution[] = ['1K', '2K', '4K'];
export const NANO_BANANA_2_ASPECT_RATIO_VALUES: NanoBanana2AspectRatio[] = [
  'auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8',
];
export const NANO_BANANA_2_RESOLUTION_VALUES: NanoBanana2Resolution[] = ['0.5K', '1K', '2K', '4K'];
export const SEEDREAM_IMAGE_SIZE_PRESET_VALUES: SeedreamImageSizePreset[] = [
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
  'auto',
  'auto_2K',
  'auto_4K',
];
export const SEEDREAM_5_IMAGE_SIZE_PRESET_VALUES: Seedream5ImageSizePreset[] = [
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
  'auto_2K',
  'auto_3K',
];
export const ASPECT_RATIO_VALUES: AspectRatio[] = ['9:16', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const createDefaultProviderImageConfig = (provider: Provider): ProviderImageConfig => {
  switch (provider) {
    case 'fal-seedream-5-pro':
    case 'fal-seedream-5-flash':
    case 'fal-flux-2-edit':
    case 'fal-seedream':
      return {
        provider,
        imageSize: 'portrait_4_3',
      };
    case 'fal-banana-pro':
      return {
        provider,
        aspectRatio: '3:4',
        resolution: '1K',
      };
    case 'openai-gpt-image-1.5':
      return {
        provider,
        size: '1024x1536',
        quality: 'medium',
      };
    case 'fal-nano-banana-2':
      return {
        provider,
        aspectRatio: '3:4',
        resolution: '1K',
      };
    case 'fal-seedream-5':
      return {
        provider,
        imageSize: 'portrait_4_3',
      };
    case 'fal-gpt-image-2.5-sunburst':
    case 'fal-gpt-image-2.5-flare':
    case 'fal-gpt-image-2':
      return {
        provider,
        imageSize: 'portrait_4_3',
        quality: 'medium',
        outputFormat: 'png',
      };
    default:
      throw new Error(`Proveedor no soportado: ${provider satisfies never}`);
  }
};

const NANO_BANANA_2_ASPECT_RATIO_NUMBERS: Partial<Record<NanoBanana2AspectRatio, number>> = {
  '21:9': 21 / 9,
  '16:9': 16 / 9,
  '3:2': 3 / 2,
  '4:3': 4 / 3,
  '5:4': 5 / 4,
  '1:1': 1,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
  '9:16': 9 / 16,
  '4:1': 4,
  '1:4': 1 / 4,
  '8:1': 8,
  '1:8': 1 / 8,
};

const BANANA_ASPECT_RATIO_NUMBERS: Record<BananaAspectRatio, number> = {
  '21:9': 21 / 9,
  '16:9': 16 / 9,
  '3:2': 3 / 2,
  '4:3': 4 / 3,
  '5:4': 5 / 4,
  '1:1': 1,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
  '9:16': 9 / 16,
};

const ASPECT_RATIO_NUMBERS: Record<AspectRatio, number> = {
  '9:16': 9 / 16,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
};

export const isOpenAIImageSize = (value: unknown): value is OpenAIImageSize =>
  OPENAI_IMAGE_SIZE_VALUES.includes(value as OpenAIImageSize);

export const isOpenAIImageQuality = (value: unknown): value is OpenAIImageQuality =>
  OPENAI_IMAGE_QUALITY_VALUES.includes(value as OpenAIImageQuality);

export const isGPTImage2ImageSizePreset = (value: unknown): value is GPTImage2ImageSizePreset =>
  GPT_IMAGE_2_IMAGE_SIZE_PRESET_VALUES.includes(value as GPTImage2ImageSizePreset);

export const isGPTImage2Quality = (value: unknown): value is GPTImage2Quality =>
  GPT_IMAGE_2_QUALITY_VALUES.includes(value as GPTImage2Quality);

export const isGPTImage2OutputFormat = (value: unknown): value is GPTImage2OutputFormat =>
  GPT_IMAGE_2_OUTPUT_FORMAT_VALUES.includes(value as GPTImage2OutputFormat);

export const isBananaAspectRatio = (value: unknown): value is BananaAspectRatio =>
  BANANA_ASPECT_RATIO_VALUES.includes(value as BananaAspectRatio);

export const isBananaResolution = (value: unknown): value is BananaResolution =>
  BANANA_RESOLUTION_VALUES.includes(value as BananaResolution);

export const isSeedreamImageSizePreset = (value: unknown): value is SeedreamImageSizePreset =>
  SEEDREAM_IMAGE_SIZE_PRESET_VALUES.includes(value as SeedreamImageSizePreset);

export const isSeedreamCustomImageSize = (value: unknown): value is SeedreamCustomImageSize => {
  if (!isRecord(value)) {
    return false;
  }

  const width = value.width;
  const height = value.height;
  if (
    typeof width !== 'number'
    || typeof height !== 'number'
    || !Number.isFinite(width)
    || !Number.isFinite(height)
  ) {
    return false;
  }

  const normalizedWidth = Math.trunc(width);
  const normalizedHeight = Math.trunc(height);
  return (
    normalizedWidth >= 512
    && normalizedHeight >= 512
    && normalizedWidth <= 4096
    && normalizedHeight <= 4096
    && normalizedWidth * normalizedHeight >= 921600
  );
};

export const isFalSeedreamImageConfig = (value: unknown): value is FalSeedreamImageConfig =>
  isRecord(value)
  && value.provider === 'fal-seedream'
  && (isSeedreamImageSizePreset(value.imageSize) || isSeedreamCustomImageSize(value.imageSize));

export const isNanoBanana2AspectRatio = (value: unknown): value is NanoBanana2AspectRatio =>
  NANO_BANANA_2_ASPECT_RATIO_VALUES.includes(value as NanoBanana2AspectRatio);

export const isNanoBanana2Resolution = (value: unknown): value is NanoBanana2Resolution =>
  NANO_BANANA_2_RESOLUTION_VALUES.includes(value as NanoBanana2Resolution);

export const isSeedream5ImageSizePreset = (value: unknown): value is Seedream5ImageSizePreset =>
  SEEDREAM_5_IMAGE_SIZE_PRESET_VALUES.includes(value as Seedream5ImageSizePreset);

export const isSeedream5CustomImageSize = (value: unknown): value is SeedreamCustomImageSize => {
  if (!isRecord(value)) return false;
  const width = value.width;
  const height = value.height;
  if (
    typeof width !== 'number'
    || typeof height !== 'number'
    || !Number.isFinite(width)
    || !Number.isFinite(height)
  ) return false;
  const w = Math.trunc(width);
  const h = Math.trunc(height);
  const area = w * h;
  return w >= 256 && h >= 256 && w <= 4096 && h <= 4096 && area >= 921600;
};

export const isGPTImage2CustomImageSize = (value: unknown): value is SeedreamCustomImageSize => {
  if (!isRecord(value)) return false;
  const width = value.width;
  const height = value.height;
  if (
    typeof width !== 'number'
    || typeof height !== 'number'
    || !Number.isFinite(width)
    || !Number.isFinite(height)
  ) return false;
  const w = Math.trunc(width);
  const h = Math.trunc(height);
  const shortest = Math.min(w, h);
  const longest = Math.max(w, h);
  const area = w * h;
  return (
    w % 16 === 0
    && h % 16 === 0
    && longest <= 3840
    && shortest > 0
    && longest / shortest <= 3
    && area >= 655360
    && area <= 8294400
  );
};

export const isFalBananaProImageConfig = (value: unknown): value is FalBananaProImageConfig =>
  isRecord(value)
  && value.provider === 'fal-banana-pro'
  && isBananaAspectRatio(value.aspectRatio)
  && isBananaResolution(value.resolution);

export const isFalNanoBanana2ImageConfig = (value: unknown): value is FalNanoBanana2ImageConfig =>
  isRecord(value)
  && value.provider === 'fal-nano-banana-2'
  && isNanoBanana2AspectRatio(value.aspectRatio)
  && isNanoBanana2Resolution(value.resolution);

export const isFalSeedream5ImageConfig = (value: unknown): value is FalSeedream5ImageConfig =>
  isRecord(value)
  && value.provider === 'fal-seedream-5'
  && (isSeedream5ImageSizePreset(value.imageSize) || isSeedream5CustomImageSize(value.imageSize));

export const isOpenAIImageConfig = (value: unknown): value is OpenAIImageConfig =>
  isRecord(value)
  && value.provider === 'openai-gpt-image-1.5'
  && isOpenAIImageSize(value.size)
  && isOpenAIImageQuality(value.quality);

export const isFalGPTImage2ImageConfig = (value: unknown): value is FalGPTImage2ImageConfig =>
  isRecord(value)
  && value.provider === 'fal-gpt-image-2'
  && (isGPTImage2ImageSizePreset(value.imageSize) || isGPTImage2CustomImageSize(value.imageSize))
  && isGPTImage2Quality(value.quality)
  && isGPTImage2OutputFormat(value.outputFormat);

export const GPT_IMAGE_25_QUALITY_VALUES: FalGPTImage25ImageConfig['quality'][] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
export const FAL_STANDARD_IMAGE_SIZE_VALUES = ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'] as const;
export const SEEDREAM_5_STANDARD_IMAGE_SIZE_VALUES = [...FAL_STANDARD_IMAGE_SIZE_VALUES, 'auto_1K', 'auto_2K'] as const;

export const isFalGPTImage25ImageConfig = (value: unknown): value is FalGPTImage25ImageConfig =>
  isRecord(value)
  && (value.provider === 'fal-gpt-image-2.5-sunburst' || value.provider === 'fal-gpt-image-2.5-flare')
  && (isGPTImage2ImageSizePreset(value.imageSize) || isGPTImage2CustomImageSize(value.imageSize))
  && GPT_IMAGE_25_QUALITY_VALUES.includes(value.quality as FalGPTImage25ImageConfig['quality'])
  && isGPTImage2OutputFormat(value.outputFormat);

const isBoundedImageSize = (value: unknown, flux: boolean): boolean => {
  if (!isRecord(value)) return false;
  const { width, height } = value;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (flux) return width >= 512 && height >= 512 && width <= 2048 && height <= 2048;
  const area = width * height;
  const ratio = width / height;
  return width > 0 && height > 0 && area >= 1024 * 1024 && area <= 2048 * 2048 && ratio >= 1 / 16 && ratio <= 16;
};

export const isFalSeedream5StandardImageConfig = (value: unknown): value is FalSeedream5StandardImageConfig =>
  isRecord(value)
  && (value.provider === 'fal-seedream-5-pro' || value.provider === 'fal-seedream-5-flash')
  && ((SEEDREAM_5_STANDARD_IMAGE_SIZE_VALUES as readonly unknown[]).includes(value.imageSize) || isBoundedImageSize(value.imageSize, false));

export const isFalFlux2ImageConfig = (value: unknown): value is FalFlux2ImageConfig =>
  isRecord(value) && value.provider === 'fal-flux-2-edit'
  && ((FAL_STANDARD_IMAGE_SIZE_VALUES as readonly unknown[]).includes(value.imageSize) || isBoundedImageSize(value.imageSize, true));

export const isProviderImageConfig = (value: unknown): value is ProviderImageConfig =>
  isFalSeedreamImageConfig(value)
  || isFalBananaProImageConfig(value)
  || isOpenAIImageConfig(value)
  || isFalNanoBanana2ImageConfig(value)
  || isFalSeedream5ImageConfig(value)
  || isFalGPTImage2ImageConfig(value)
  || isFalGPTImage25ImageConfig(value)
  || isFalSeedream5StandardImageConfig(value)
  || isFalFlux2ImageConfig(value);

export const createLegacyProviderImageConfig = (provider: Provider, aspectRatio: AspectRatio): ProviderImageConfig => {
  switch (provider) {
    case 'fal-seedream-5-pro':
    case 'fal-seedream-5-flash':
    case 'fal-flux-2-edit':
    case 'fal-seedream':
      return {
        provider,
        imageSize: mapLegacyAspectRatioToSeedreamImageSize(aspectRatio),
      };
    case 'fal-banana-pro':
      return {
        provider,
        aspectRatio,
        resolution: '1K',
      };
    case 'openai-gpt-image-1.5':
      return {
        provider,
        size: mapLegacyAspectRatioToOpenAIImageSize(aspectRatio),
        quality: 'medium',
      };
    case 'fal-nano-banana-2':
      return {
        provider,
        aspectRatio,
        resolution: '1K',
      };
    case 'fal-seedream-5':
      return {
        provider,
        imageSize: mapLegacyAspectRatioToSeedream5ImageSize(aspectRatio),
      };
    case 'fal-gpt-image-2.5-sunburst':
    case 'fal-gpt-image-2.5-flare':
    case 'fal-gpt-image-2':
      return {
        provider,
        imageSize: mapLegacyAspectRatioToGPTImage2ImageSize(aspectRatio),
        quality: 'medium',
        outputFormat: 'png',
      };
    default:
      throw new Error(`Proveedor no soportado: ${provider satisfies never}`);
  }
};

export const cloneProviderImageConfig = (config: ProviderImageConfig): ProviderImageConfig => {
  if ('imageSize' in config && typeof config.imageSize !== 'string') {
    return { ...config, imageSize: { ...config.imageSize } };
  }
  return { ...config };
};

export const mapLegacyAspectRatioToSeedreamImageSize = (aspectRatio: AspectRatio): Exclude<GPTImage2ImageSizePreset, 'auto'> => {
  switch (aspectRatio) {
    case '9:16':
      return 'portrait_16_9';
    case '3:4':
    case '2:3':
      return 'portrait_4_3';
    case '1:1':
      return 'square_hd';
    case '4:3':
    case '3:2':
      return 'landscape_4_3';
    case '16:9':
      return 'landscape_16_9';
    default:
      return 'square_hd';
  }
};

export const mapLegacyAspectRatioToSeedream5ImageSize = (aspectRatio: AspectRatio): Seedream5ImageSizePreset => {
  switch (aspectRatio) {
    case '9:16':
      return 'portrait_16_9';
    case '3:4':
    case '2:3':
      return 'portrait_4_3';
    case '1:1':
      return 'square_hd';
    case '4:3':
    case '3:2':
      return 'landscape_4_3';
    case '16:9':
      return 'landscape_16_9';
    default:
      return 'square_hd';
  }
};

export const mapLegacyAspectRatioToGPTImage2ImageSize = (aspectRatio: AspectRatio): GPTImage2ImageSizePreset => {
  switch (aspectRatio) {
    case '9:16':
      return 'portrait_16_9';
    case '3:4':
    case '2:3':
      return 'portrait_4_3';
    case '1:1':
      return 'square_hd';
    case '4:3':
    case '3:2':
      return 'landscape_4_3';
    case '16:9':
      return 'landscape_16_9';
    default:
      return 'square_hd';
  }
};

export const mapLegacyAspectRatioToOpenAIImageSize = (aspectRatio: AspectRatio): OpenAIImageSize => {
  if (aspectRatio === '1:1') {
    return '1024x1024';
  }

  const [width, height] = aspectRatio.split(':').map(Number);
  return width > height ? '1536x1024' : '1024x1536';
};

const getClosestAspectRatio = (ratio: number): AspectRatio =>
  ASPECT_RATIO_VALUES.reduce<AspectRatio>((closest, candidate) => {
    const currentDistance = Math.abs(ASPECT_RATIO_NUMBERS[candidate] - ratio);
    const closestDistance = Math.abs(ASPECT_RATIO_NUMBERS[closest] - ratio);
    return currentDistance < closestDistance ? candidate : closest;
  }, '1:1');

export const resolveAspectRatioForImageConfig = (config: ProviderImageConfig): AspectRatio => {
  switch (config.provider) {
    case 'fal-seedream-5-pro':
    case 'fal-seedream-5-flash':
    case 'fal-flux-2-edit':
    case 'fal-seedream':
      if (typeof config.imageSize !== 'string') {
        return getClosestAspectRatio(config.imageSize.width / config.imageSize.height);
      }

      switch (config.imageSize) {
        case 'portrait_16_9':
          return '9:16';
        case 'portrait_4_3':
          return '3:4';
        case 'landscape_4_3':
          return '4:3';
        case 'landscape_16_9':
          return '16:9';
        case 'square':
        case 'square_hd':
        case 'auto':
        case 'auto_2K':
        case 'auto_4K':
        default:
          return '1:1';
      }
    case 'fal-banana-pro':
      return config.aspectRatio in ASPECT_RATIO_NUMBERS
        ? (config.aspectRatio as AspectRatio)
        : getClosestAspectRatio(BANANA_ASPECT_RATIO_NUMBERS[config.aspectRatio]);
    case 'openai-gpt-image-1.5':
      switch (config.size) {
        case '1024x1536':
          return '2:3';
        case '1536x1024':
          return '3:2';
        case '1024x1024':
        default:
          return '1:1';
      }
    case 'fal-nano-banana-2': {
      if (config.aspectRatio === 'auto') return '1:1';
      if (config.aspectRatio in ASPECT_RATIO_NUMBERS) return config.aspectRatio as AspectRatio;
      const ratio = NANO_BANANA_2_ASPECT_RATIO_NUMBERS[config.aspectRatio];
      return ratio !== undefined ? getClosestAspectRatio(ratio) : '1:1';
    }
    case 'fal-seedream-5':
      if (typeof config.imageSize !== 'string') {
        return getClosestAspectRatio(config.imageSize.width / config.imageSize.height);
      }

      switch (config.imageSize) {
        case 'portrait_16_9':
          return '9:16';
        case 'portrait_4_3':
          return '3:4';
        case 'landscape_4_3':
          return '4:3';
        case 'landscape_16_9':
          return '16:9';
        case 'square':
        case 'square_hd':
        case 'auto_2K':
        case 'auto_3K':
        default:
          return '1:1';
      }
    case 'fal-gpt-image-2.5-sunburst':
    case 'fal-gpt-image-2.5-flare':
    case 'fal-gpt-image-2':
      if (typeof config.imageSize !== 'string') {
        return getClosestAspectRatio(config.imageSize.width / config.imageSize.height);
      }

      switch (config.imageSize) {
        case 'portrait_16_9':
          return '9:16';
        case 'portrait_4_3':
          return '3:4';
        case 'landscape_4_3':
          return '4:3';
        case 'landscape_16_9':
          return '16:9';
        case 'square':
        case 'square_hd':
        case 'auto':
        default:
          return '1:1';
      }
    default:
      throw new Error(`Proveedor no soportado: ${config satisfies never}`);
  }
};

export const normalizeProviderImageConfig = (
  provider: Provider,
  config: unknown,
  legacyAspectRatio?: AspectRatio | null,
): { imageConfig: ProviderImageConfig; aspectRatio: AspectRatio } => {
  if (isProviderImageConfig(config) && config.provider === provider) {
    const cloned = cloneProviderImageConfig(config);
    return {
      imageConfig: cloned,
      aspectRatio: resolveAspectRatioForImageConfig(cloned),
    };
  }

  if (legacyAspectRatio) {
    const fallback = createLegacyProviderImageConfig(provider, legacyAspectRatio);
    return {
      imageConfig: fallback,
      aspectRatio: resolveAspectRatioForImageConfig(fallback),
    };
  }

  const fallback = createDefaultProviderImageConfig(provider);
  return {
    imageConfig: fallback,
    aspectRatio: resolveAspectRatioForImageConfig(fallback),
  };
};

export const summarizeProviderImageConfig = (config: ProviderImageConfig): string => {
  switch (config.provider) {
    case 'fal-seedream-5-pro':
    case 'fal-seedream-5-flash':
    case 'fal-flux-2-edit':
    case 'fal-seedream':
      return typeof config.imageSize === 'string'
        ? config.imageSize
        : `${config.imageSize.width}x${config.imageSize.height}`;
    case 'fal-banana-pro':
      return `${config.aspectRatio} · ${config.resolution}`;
    case 'openai-gpt-image-1.5':
      return `${config.size} · ${config.quality}`;
    case 'fal-nano-banana-2':
      return `${config.aspectRatio} · ${config.resolution}`;
    case 'fal-seedream-5':
      return typeof config.imageSize === 'string'
        ? config.imageSize
        : `${config.imageSize.width}x${config.imageSize.height}`;
    case 'fal-gpt-image-2.5-sunburst':
    case 'fal-gpt-image-2.5-flare':
    case 'fal-gpt-image-2':
      return `${typeof config.imageSize === 'string'
        ? config.imageSize
        : `${config.imageSize.width}x${config.imageSize.height}`} · ${config.quality} · ${config.outputFormat}`;
    default:
      throw new Error(`Proveedor no soportado: ${config satisfies never}`);
  }
};
