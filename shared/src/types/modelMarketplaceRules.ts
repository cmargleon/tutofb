import type { MarketplaceId } from '../marketplaces';
import type { ModelSetShot } from './modelPhotoSet';

export interface ModelMarketplaceAppearance {
  background: 'client' | 'white' | 'neutral';
  framing: 'auto' | 'upper_body' | 'lower_body' | 'full_body';
  face: 'auto' | 'visible' | 'hidden';
  lookingAtCamera: boolean;
  standingFront: boolean;
}
export interface ModelMarketplaceRule {
  aspectRatio: 'client' | '3:4' | '4:3' | '1:1';
  shots: ModelSetShot[];
  allowedPoseRecipeIds: string[];
  main: ModelMarketplaceAppearance;
  alternative: ModelMarketplaceAppearance;
  validation: { garmentVisible: boolean; noAccessories: boolean; pureWhite: boolean };
}
export interface StoredModelMarketplaceRule extends ModelMarketplaceRule { revision: number }
export type ModelMarketplaceRules = Partial<Record<MarketplaceId, StoredModelMarketplaceRule>>;
export interface SaveModelMarketplaceRuleRequest {
  marketplaceId: MarketplaceId;
  expectedRevision: number;
  rule: ModelMarketplaceRule;
}
export interface SaveModelMarketplaceRuleResponse { rule: StoredModelMarketplaceRule }
