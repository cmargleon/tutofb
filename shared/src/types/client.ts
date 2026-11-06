import type { TimestampLike, CatalogEntityStatus } from './common';

export interface Client {
  id?: string;
  name: string;
  marketplaces?: Partial<Record<import('../marketplaces').MarketplaceId, import('./marketplace').ClientMarketplaceConfig>>;
  automation?: import('./automation').ClientAutomationConfig;
  generationPromptBase?: string | null;
  status?: CatalogEntityStatus;
  archivedAt?: TimestampLike | null;
  archivedByUid?: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  batchCount: number;
  lastBatchCreatedAt: TimestampLike | null;
  createdByUid: string;
}

export interface PermanentDeleteCatalogEntityRequest {
  id: string;
}

export interface PermanentDeleteCatalogEntityResponse {
  success: boolean;
  id: string;
}
