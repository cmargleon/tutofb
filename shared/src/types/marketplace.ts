import type { MarketplaceId } from '../marketplaces';
import type { TimestampLike } from './common';

export interface ClientMarketplaceConfig {
  enabled: boolean;
  settings?: { region?: string; sellerId?: string };
  updatedAt?: TimestampLike;
}

export interface UpdateClientMarketplaceRequest {
  clientId: string;
  marketplaceId: MarketplaceId;
  enabled?: boolean;
  settings?: ClientMarketplaceConfig['settings'];
}
export interface UpdateClientMarketplaceResponse { success: boolean }
