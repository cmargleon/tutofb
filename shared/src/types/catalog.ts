import type { ProductEvidence } from './marketplaceExport';
import type { TimestampLike } from './common';

export const CATALOG_STATUSES = ['draft', 'active', 'archived'] as const;
export type CatalogStatus = typeof CATALOG_STATUSES[number];
export interface CatalogIssue {
  id: string; kind: 'conflict' | 'possible_duplicate' | 'identity'; field: string;
  current: string; incoming: string; reference: string;
}
export interface CatalogMetadata {
  version: 1; status: CatalogStatus; createdAt: TimestampLike;
  evidence: Record<string, ProductEvidence>;
  attributes: Record<string, string>;
  issues: CatalogIssue[];
  /** Bounded, indexed search projection; original identifiers remain strings. */
  searchKeys: string[];
  redirectTo?: string;
  manuallyConfirmed?: boolean;
  thumbnailPath?: string;
  selectedImages?: Array<{ linkId: string; jobId: string; outputId: string }>;
}
export interface CatalogGenerationLink {
  id: string; clientId: string; batchId: string; legacyProductId: string; garmentId: string;
  draftIds: string[]; organizerReferences: string[]; variantMap: Record<string, string>;
}
/** Incorporation of one generation source (job/draft event) into a canonical product. */
export interface ApplyCatalogImportRequest {
  clientId: string; batchId: string;
  legacyProductId: string; productId: string; expectedRevision: number;
  fingerprint: string; confirmAssociation: boolean;
  expectedSourceRevision?: number;
  /** Required when the projected variant ID differs from the canonical variant. */
  variantMap?: Record<string, string>;
}
