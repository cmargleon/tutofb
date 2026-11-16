import type { MarketplaceId } from '../marketplaces';
import type { TimestampLike } from './common';
import type { PhotoRecipe } from './photoPlan';

export interface ClientMarketplaceConfig {
  enabled: boolean;
  settings?: { region?: string; sellerId?: string };
  photoRecipe?: PhotoRecipe;
  photoRecipeRevision?: number;
  updatedAt?: TimestampLike;
}

export interface UpdateClientMarketplaceRequest {
  clientId: string;
  marketplaceId: MarketplaceId;
  enabled?: boolean;
  settings?: ClientMarketplaceConfig['settings'];
  photoRecipe?: PhotoRecipe | null;
  expectedPhotoRecipeRevision?: number;
  expected?: { enabled?: boolean; region?: string; sellerId?: string };
}
export interface UpdateClientMarketplaceResponse {
  success: boolean;
  current: { enabled: boolean; region: string; sellerId: string; photoRecipe?: PhotoRecipe | null; photoRecipeRevision?: number };
}
