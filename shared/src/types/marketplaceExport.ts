import type { MarketplaceId } from '../marketplaces';
import type { TimestampLike } from './common';
import type { ProductDraft, ProductDraftRow, SpreadsheetTemplate, SpreadsheetTemplateCategory } from './spreadsheet';

export const PRODUCT_FIELDS = ['name', 'description', 'brand', 'category', 'sku', 'material', 'composition', 'price', 'currency', 'inventory', 'weight', 'weightUnit', 'length', 'width', 'height', 'dimensionUnit'] as const;
export const VARIANT_FIELDS = ['sku', 'color', 'size', 'price', 'inventory', 'gtin', 'asin', 'catalogId', 'spu', 'skc', 'parentSku', 'parentage', 'relationshipType', 'variationTheme', 'gtinExemption'] as const;
export type ProductField = typeof PRODUCT_FIELDS[number];
export type VariantField = typeof VARIANT_FIELDS[number];
export interface ProductEvidence { original: string; normalized: string; source: 'manual' | 'legacy' | 'ai'; confidence: number | null }
export interface MasterVariant { id: string; values: Partial<Record<VariantField, string>>; attributes?: Record<string, string> }
export interface ProductMarketplaceData {
  templateId: string; categoryId: string;
  /** Explicit output values, never copied back into master fields. */
  rows?: ProductDraftRow[];
  requirements?: { gtinExemptionByVariant?: Record<string, 'pending' | 'approved'>; brandSnapshot?: string; categoryIdSnapshot?: string };
  imageUrls?: Record<string, string>; // approved output ID -> operator-authorized public URL
}
export interface MasterProduct {
  id: string; clientId: string; batchIds: string[]; garmentId: string;
  values: Partial<Record<ProductField, string>>;
  variants: MasterVariant[];
  evidence: Record<string, ProductEvidence>;
  legacyDrafts: ProductDraft[];
  originalImages: Array<{ storagePath: string; fileName: string }>;
  approvedImages: Array<{ outputId: string; jobId: string; storagePath: string }>;
  generatedImages?: Array<{ outputId: string; jobId: string; storagePath: string; approved: boolean }>;
  pendingImages: number;
  marketplaces: Partial<Record<MarketplaceId, ProductMarketplaceData>>;
  revision: number;
}
export interface StoredMasterProduct {
  clientId: string; values: MasterProduct['values']; variants: MasterVariant[];
  marketplaces: MasterProduct['marketplaces']; revision: number;
  updatedAt: TimestampLike; updatedByUid: string;
}
export interface TemplateColumnMapping { source: string; valueMap?: Record<string, string>; required?: boolean; dataType?: 'text' | 'number' }
export interface MarketplaceTemplateConfig {
  marketplaceId: MarketplaceId;
  version: number; replacesTemplateId?: string | null; legacyTemplateIds?: string[];
  operation: 'new_product' | 'existing_catalog' | 'listing';
  validationStatus: 'needs_configuration' | 'compatible' | 'incompatible';
  validationMessages: string[];
  /** Immutable once activated. Replacements create another template document. */
  mappings: Record<string, Record<string, TemplateColumnMapping>>;
  confirmedAt?: TimestampLike;
}
export interface MarketplaceExportScope { clientId: string; batchIds: string[] }
export interface MarketplaceExportIssue { marketplaceId: MarketplaceId; productId?: string; productName?: string; field?: string; code: string; message: string }
export interface MarketplaceReadiness { marketplaceId: MarketplaceId; ready: boolean; compatibleTemplates: number; issues: MarketplaceExportIssue[] }
export interface MarketplaceExportPreview {
  clientName: string; products: MasterProduct[]; templates: SpreadsheetTemplate[];
  categories: SpreadsheetTemplateCategory[]; channels: MarketplaceReadiness[];
}
export interface DownloadMarketplaceExportRequest extends MarketplaceExportScope { marketplaceIds: MarketplaceId[]; requestId: string }
export interface DownloadMarketplaceExportResponse {
  fileName: string | null; downloadUrl: string | null; expiresAt: number;
  failures: Array<{ marketplaceId: MarketplaceId; message: string }>; exportedMarketplaces: MarketplaceId[];
}
export interface ConfigureMarketplaceTemplateRequest {
  clientId: string; templateId: string; marketplaceId: MarketplaceId;
  operation: MarketplaceTemplateConfig['operation']; layouts?: Record<string, { rowStart: number }>; mappings: MarketplaceTemplateConfig['mappings'];
}
export interface SaveMasterProductRequest extends MarketplaceExportScope { productId: string; authorizePublicImages?: boolean; expectedRevision: number; values: MasterProduct['values']; variants: MasterVariant[]; marketplaces: MasterProduct['marketplaces'] }
