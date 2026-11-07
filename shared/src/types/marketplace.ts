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
  expected?: { enabled?: boolean; region?: string; sellerId?: string };
}
export interface UpdateClientMarketplaceResponse { success: boolean; current: { enabled: boolean; region: string; sellerId: string } }
