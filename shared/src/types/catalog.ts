import type { MasterProduct, MasterVariant, ProductEvidence, StoredMasterProduct } from './marketplaceExport';
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
export interface CatalogProduct extends StoredMasterProduct { id: string }
export interface CatalogScope { clientId: string }
export interface CatalogPageRequest extends CatalogScope { cursor?: string; pageSize?: number; search?: string; status?: CatalogStatus }
export interface CatalogPage { products: CatalogProduct[]; nextCursor: string | null }
export interface CatalogProductRequest extends CatalogScope { productId: string; cursor?: string }
export interface CatalogGenerationLink {
  id: string; clientId: string; batchId: string; legacyProductId: string; garmentId: string;
  draftIds: string[]; organizerReferences: string[]; variantMap: Record<string, string>;
}
export interface CatalogProductDetail {
  product: CatalogProduct; links: CatalogGenerationLink[]; nextCursor: string | null;
}
export interface SaveCatalogProductRequest extends CatalogScope {
  /** Chosen once by the caller (UUID); retrying creation reuses this ID. */
  productId: string; expectedRevision: number;
  values: MasterProduct['values']; variants: MasterVariant[];
  status: CatalogStatus; attributes: Record<string, string>;
  /** Only explicitly verified identifiers are marked confirmed. */
  verifiedGtinVariantIds?: string[];
  resolveIssueIds?: string[];
  selectedImages?: NonNullable<CatalogMetadata['selectedImages']>;
}
export interface SaveCatalogProductResponse { productId: string; revision: number }
export interface CatalogImportRequest extends CatalogScope { batchId: string }
export interface CatalogImportCandidate { product: MasterProduct; fingerprint: string; linkedProductId: string | null; possibleDuplicateIds: string[]; currentRevision: number }
export interface CatalogImportPreview { candidates: CatalogImportCandidate[] }
export interface ApplyCatalogImportRequest extends CatalogImportRequest {
  legacyProductId: string; productId: string; expectedRevision: number;
  fingerprint: string; confirmAssociation: boolean;
  expectedSourceRevision?: number;
  /** Required when the projected variant ID differs from the canonical variant. */
  variantMap?: Record<string, string>;
}
export interface CatalogBatchPageRequest extends CatalogScope { cursor?: string; pageSize?: number }
export interface CatalogBatchPage { batches: Array<{ id: string; createdAt: TimestampLike }>; nextCursor: string | null }
export interface CatalogGenerationImagesRequest extends CatalogProductRequest { linkId: string }
export interface CatalogGenerationImages { products: MasterProduct[] }
