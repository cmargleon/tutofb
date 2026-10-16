import type { TimestampLike, CatalogEntityStatus } from './common';

export interface Client {
  id?: string;
  name: string;
  automation?: { defaultModelId?: string; defaultPreset?: string; presets?: Record<string, import('./automation').AutomationPreset> };
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
