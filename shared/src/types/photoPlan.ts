import type { MarketplaceId } from '../marketplaces';
import type { AspectRatio, GenerationKind, GarmentBodyArea, GarmentView, Provider } from './common';
import type { ProviderImageConfig } from './provider';
import type { ClientMarketplaceConfig } from './marketplace';
export type PhotoAttribute<T> = { value: T | null; confidence: number | null; evidence: string; source: 'commercial' | 'manual' | 'gemini' };
export interface PhotoArticleAttributes {
  category: PhotoAttribute<'ordinary' | 'bodysuit' | 'fitted_child' | 'underwear' | 'swimwear' | 'accessory' | 'object'>;
  audience: PhotoAttribute<'baby' | 'child' | 'adult'>;
  bodyArea: PhotoAttribute<GarmentBodyArea>;
  gender: PhotoAttribute<'male' | 'female' | 'unisex'>;
  packaging: PhotoAttribute<'unit' | 'set' | 'multipack'>;
  transparency: PhotoAttribute<boolean>;
  components: PhotoAttribute<string>;
  color: PhotoAttribute<string>;
}
export interface PhotoArticle {
  itemId: string; productId: string; variantId: string; name: string; kind: GenerationKind;
  attributes: Partial<PhotoArticleAttributes>;
  references: Array<{ id: string; storagePath: string; view: GarmentView | 'detail'; sha256?: string }>;
}
export interface PhotoBaseObservation {
  whiteRgbVerified?: boolean;
  audience?: 'baby' | 'child' | 'adult';
  orientation: GarmentView; posture: 'standing' | 'other'; framing: 'upper_body' | 'lower_body' | 'full_body';
  background: 'white' | 'neutral' | 'context'; garmentVisible: boolean; accessories: boolean;
  performer: 'synthetic' | 'real' | 'unknown'; verified: boolean; evidence: string;
}
export interface PhotoBase { id: string; storagePath: string; observation?: PhotoBaseObservation }
export interface PhotoRequirement {
  id: string; channel: MarketplaceId | 'common'; category: string; imageType: 'all' | 'main' | 'alternative';
  level: 'obligation' | 'recommendation' | 'preference'; verified: boolean; text: string;
}
export interface PhotoDestination {
  channel: MarketplaceId; productId: string; variantId: string; position: number; role: 'main' | 'alternative';
  required: boolean; ruleIds: string[]; imageType?: number; imageSort?: number;
}
export interface PhotoTask {
  id: string; itemId: string; productId: string; variantId: string; referencePaths: string[];
  backgroundCorrection?: 'neutral-white-perimeter';
  sceneId?: string;
  view: GarmentView | 'detail'; composition: 'model' | 'flat_lay' | 'product' | 'reference';
  background: 'white' | 'neutral' | 'context' | 'original'; bodyArea: GarmentBodyArea | null;
  identityBase?: PhotoBase | null;
  base: PhotoBase | null; syntheticPerformer: boolean; instructions: string; destinations: PhotoDestination[];
}
export interface PhotoPlanInput {
  clientId: string; marketplaces?: Partial<Record<MarketplaceId, ClientMarketplaceConfig>>;
  objectScenes?: import('./productGeneration').ProductSceneInput[];
  articles: PhotoArticle[]; bases?: PhotoBase[]; provider: Provider; imageConfig: ProviderImageConfig; aspectRatio: AspectRatio;
}
export interface PhotoPlan {
  version: 'marketplace-photo-v1'; id: string; clientId: string; channels: MarketplaceId[];
  articles: PhotoArticle[]; rules: PhotoRequirement[]; tasks: PhotoTask[];
  issues: Array<{ itemId: string; code: string; message: string; blocking: boolean }>;
  effectiveConfig: Pick<PhotoPlanInput, 'provider' | 'imageConfig' | 'aspectRatio'>;
  estimate: { uniqueImages: number; generations: number; reviews: number; estimatedCostUsd: number };
}
export interface CreateMarketplacePhotoBatchRequest extends PhotoPlanInput {
  requestId: string; approvedPlanId: string; prompt: string; modelId?: string | null;
}
export interface PhotoAssignment extends PhotoDestination { taskId: string; angle: string; outputId: string | null; jobId: string; eligible: boolean }
