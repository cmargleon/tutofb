import type { Provider, AspectRatio } from './common';

export type BananaAspectRatio = '21:9' | '16:9' | '3:2' | '4:3' | '5:4' | '1:1' | '4:5' | '3:4' | '2:3' | '9:16';
export type BananaResolution = '1K' | '2K' | '4K';
export type NanoBanana2AspectRatio = 'auto' | '21:9' | '16:9' | '3:2' | '4:3' | '5:4' | '1:1' | '4:5' | '3:4' | '2:3' | '9:16' | '4:1' | '1:4' | '8:1' | '1:8';
export type NanoBanana2Resolution = '0.5K' | '1K' | '2K' | '4K';
export type OpenAIImageSize = '1024x1024' | '1024x1536' | '1536x1024';
export type OpenAIImageQuality = 'low' | 'medium' | 'high';
export type SeedreamImageSizePreset =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | 'auto'
  | 'auto_2K'
  | 'auto_4K';

export type Seedream5ImageSizePreset =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'
  | 'auto_2K'
  | 'auto_3K';

export interface SeedreamCustomImageSize {
  width: number;
  height: number;
}

export interface FalSeedreamImageConfig {
  provider: 'fal-seedream';
  imageSize: SeedreamImageSizePreset | SeedreamCustomImageSize;
}

export interface FalBananaProImageConfig {
  provider: 'fal-banana-pro';
  aspectRatio: BananaAspectRatio;
  resolution: BananaResolution;
}

export interface OpenAIImageConfig {
  provider: 'openai-gpt-image-1.5';
  size: OpenAIImageSize;
  quality: OpenAIImageQuality;
}

export interface FalNanoBanana2ImageConfig {
  provider: 'fal-nano-banana-2';
  aspectRatio: NanoBanana2AspectRatio;
  resolution: NanoBanana2Resolution;
}

export interface FalSeedream5ImageConfig {
  provider: 'fal-seedream-5';
  imageSize: Seedream5ImageSizePreset | SeedreamCustomImageSize;
}

export type ProviderImageConfig =
  | FalSeedreamImageConfig
  | FalBananaProImageConfig
  | OpenAIImageConfig
  | FalNanoBanana2ImageConfig
  | FalSeedream5ImageConfig;

// Re-export for convenience — provider.ts is the natural home for Provider too
export type { Provider, AspectRatio };
