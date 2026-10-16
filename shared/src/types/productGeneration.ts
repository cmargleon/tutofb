import type { Provider, AspectRatio } from './common';
import type { ProviderImageConfig } from './provider';

export type ProductSceneType = 'clean' | 'lifestyle_1' | 'lifestyle_2' | 'hero' | 'human_use_1' | 'human_use_2';
export interface ProductSceneInput { type: ProductSceneType; prompt: string }
export interface ProductGenerationItem { id: string; name: string; referencePaths: string[] }
export interface CreateProductGenerationBatchRequest {
  requestId: string;
  clientId: string;
  items: ProductGenerationItem[];
  scenes: ProductSceneInput[];
  prompt: string;
  provider: Provider;
  aspectRatio?: AspectRatio;
  imageConfig?: ProviderImageConfig;
}
