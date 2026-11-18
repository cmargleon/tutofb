import type { MarketplaceId } from '../marketplaces';
import type { TimestampLike } from './common';
import type { ProductDraft, ProductDraftRow, SpreadsheetTemplate, SpreadsheetTemplateCategory } from './spreadsheet';

export const PRODUCT_FIELDS = ['name', 'description', 'brand', 'category', 'sku', 'material', 'composition', 'price', 'currency', 'inventory', 'weight', 'weightUnit', 'length', 'width', 'height', 'dimensionUnit'] as const;
export const VARIANT_FIELDS = ['sku', 'color', 'size', 'pack', 'price', 'inventory', 'weight', 'weightUnit', 'length', 'width', 'height', 'dimensionUnit', 'gtin', 'asin', 'catalogId', 'spu', 'skc', 'parentSku', 'parentage', 'relationshipType', 'variationTheme', 'gtinExemption'] as const;
export type ProductField = typeof PRODUCT_FIELDS[number];
export type VariantField = typeof VARIANT_FIELDS[number];
export interface ProductEvidence { original: string; normalized: string; source: 'manual' | 'legacy' | 'ai' | 'drive'; confidence: number | null; state?: 'unknown' | 'empty' | 'confirmed' | 'suggested'; verified?: boolean; reference?: string }
export const ORGANIZER_SOURCE_FIELDS = ['price', 'inventory', 'weight', 'weightUnit', 'length', 'width', 'height', 'dimensionUnit'] as const;
export type OrganizerSourceField = typeof ORGANIZER_SOURCE_FIELDS[number];
export type OrganizerSourceColumns = Partial<Record<OrganizerSourceField, string>>;
export interface OrganizerRowOrigin { fileId: string; fileName: string; version: string; tab: string; row: number }
export interface OrganizerCommercialSource {
  variants: MasterVariant[];
  origins: Record<string, OrganizerRowOrigin[]>;
  values: MasterProduct['values'];
  issue: string | null;
}
export interface OrganizerCategoryDecision {
  marketplaceId: MarketplaceId;
  templateId: string | null;
  categoryId: string | null;
  version: number | null;
  confidence: number | null;
  reason: string;
}
export interface MasterVariant { id: string; values: Partial<Record<VariantField, string>>; attributes?: Record<string, string>; evidence?: Record<string, ProductEvidence> }
export interface PublishedMarketplaceImage {
  outputId: string; jobId: string; sourceStoragePath: string;
  marketplaceId: MarketplaceId; profileVersion: string;
  bucket: string; storagePath: string; url: string;
  contentType: 'image/jpeg'; width: number; height: number; bytes: number;
  publishedAt: TimestampLike; publishedByUid: string;
}
export interface ProductMarketplaceData {
  templateId: string; categoryId: string;
  /** Explicit output values, never copied back into master fields. */
  rows?: ProductDraftRow[];
  requirements?: { gtinExemptionByVariant?: Record<string, 'pending' | 'approved'>; brandSnapshot?: string; categoryIdSnapshot?: string };
  imageUrls?: Record<string, string>; // approved output ID -> operator-authorized public URL
}
export interface MasterProduct {
  canonicalProductId?: string;
  marketplaceCategorySuggestions?: Partial<Record<MarketplaceId, { templateId: string; categoryId: string; reason: string }>>;
  photoAssignments?: import('./photoPlan').PhotoAssignment[];
  id: string; clientId: string; batchIds: string[]; garmentId: string;
  values: Partial<Record<ProductField, string>>;
  variants: MasterVariant[];
  evidence: Record<string, ProductEvidence>;
  legacyDrafts: ProductDraft[];
  originalImages: Array<{ storagePath: string; fileName: string }>;
  approvedImages: Array<{ outputId: string; jobId: string; storagePath: string }>;
  generatedImages?: Array<{ outputId: string; jobId: string; storagePath: string; approved: boolean }>;
  /** Server projection of publications still associated with approved outputs. */
  publishedImages?: Partial<Record<MarketplaceId, Record<string, PublishedMarketplaceImage>>>;
  /** Template choices vetted by the server for this export context. */
  marketplaceAutofill?: Partial<Record<MarketplaceId, MarketplaceAutofillRow[]>>;
  /** Server-managed square derivatives by SHEIN variant ID. */
  marketplaceSquares?: Record<string, { storagePath: string; url?: string }>;
  pendingImages: number;
  marketplaces: Partial<Record<MarketplaceId, ProductMarketplaceData>>;
  revision: number;
  organizer?: { source: OrganizerCommercialSource; category: OrganizerCategoryDecision | null; revision?: string; confirmedIdentity?: boolean };
}
export interface StoredMasterProduct {
  catalog?: import('./catalog').CatalogMetadata;
  clientId: string; values: MasterProduct['values']; variants: MasterVariant[];
  marketplaces: MasterProduct['marketplaces']; revision: number;
  updatedAt: TimestampLike; updatedByUid: string;
  organizerOverrides?: { variants: MasterVariant[]; removedVariantIds: string[]; addedVariantIds: string[]; confirmedIdentity?: boolean };
}
export interface TemplateColumnMapping { source: string; valueMap?: Record<string, string>; required?: boolean; dataType?: 'text' | 'number' }
export interface MarketplaceTemplateConfig {
  marketplaceId: MarketplaceId;
  /** Zero while pending; released versions count activations only. */
  version: number; replacesTemplateId?: string | null; legacyTemplateIds?: string[];
  /** Superseded versions remain exportable for products already linked to them. */
  supersededByTemplateId?: string | null;
  operation: 'new_product' | 'existing_catalog' | 'listing';
  validationStatus: 'needs_configuration' | 'compatible' | 'incompatible';
  validationMessages: string[];
  /** Immutable once activated. Replacements create another template document. */
  mappings: Record<string, Record<string, TemplateColumnMapping>>;
  confirmedAt?: TimestampLike;
}
/**
 * Gemini's choice for each template dropdown of one variant. Values are always valid template options and
 * are exported unless the operator overrides them. Tentative fields carry Gemini's reason in `reasons`;
 * `failures` explains fields left pending after the automatic retry.
 */
export type MarketplaceAutofillRow = ProductDraftRow & {
  inferredFields: string[];
  tentativeFields?: string[];
  reasons?: Record<string, string>;
  failures?: Record<string, string>;
};
export interface MarketplaceExportScope { clientId: string; batchIds: string[]; masterProductId?: string; organizerContext?: import('./organizer').OrganizerProductContext }
export interface PublishMarketplaceImagesRequest extends MarketplaceExportScope {
  productId: string; marketplaceId: MarketplaceId; authorizePublicImages: boolean;
}
export interface PublishMarketplaceImagesResponse {
  images: PublishedMarketplaceImage[];
  failures: Array<{ outputId: string; message: string }>;
}
export interface MarketplaceExportIssue {
  marketplaceId: MarketplaceId;
  productId?: string;
  productName?: string;
  variantId?: string;
  field?: string;
  blocking?: false;
  code: string;
  message: string;
}
export interface MarketplaceReadiness { marketplaceId: MarketplaceId; ready: boolean; compatibleTemplates: number; issues: MarketplaceExportIssue[] }
export interface MarketplaceExportPreview {
  clientName: string; products: MasterProduct[]; templates: SpreadsheetTemplate[];
  categories: SpreadsheetTemplateCategory[]; channels: MarketplaceReadiness[];
  /** Gemini failed or produced no valid option for some fields after its automatic retry. */
  autofillIncomplete?: boolean;
  /** Some Gemini analyses are not available yet; request the preview again with `analyzeAutofill`. */
  autofillPending?: boolean;
}
/** `analyzeAutofill` runs (or waits for) the Gemini analyses that the plain preview reports as pending. */
export interface MarketplaceExportPreviewRequest extends MarketplaceExportScope { analyzeAutofill?: boolean }
export interface DownloadMarketplaceExportRequest extends MarketplaceExportScope {
  marketplaceIds: MarketplaceId[];
  requestId: string;
  /** Allows publication of approved images needed for the selected exports. */
  authorizePublicImages?: boolean;
}
export interface DownloadMarketplaceExportResponse {
  fileName: string | null; downloadUrl: string | null; expiresAt: number;
  failures: Array<{ marketplaceId: MarketplaceId; message: string }>; exportedMarketplaces: MarketplaceId[];
}
export interface ConfigureMarketplaceTemplateRequest {
  clientId: string; templateId: string; marketplaceId: MarketplaceId;
  operation: MarketplaceTemplateConfig['operation']; layouts?: Record<string, { rowStart: number }>; mappings: MarketplaceTemplateConfig['mappings'];
  reviewOnly?: boolean;
}
export interface ConfigureMarketplaceTemplateResponse {
  success: boolean;
  templateId: string;
  review?: { config: MarketplaceTemplateConfig; categories: SpreadsheetTemplateCategory[]; unresolvedRequired: string[] };
}
/** Marketplaces is a patch: omitted channels are preserved; disabled channels cannot change. */
export interface SaveMasterProductRequest extends MarketplaceExportScope { productId: string; authorizePublicImages?: boolean; expectedRevision: number; organizerSourceRevision?: string; confirmOrganizerIdentity?: boolean; values: MasterProduct['values']; variants: MasterVariant[]; marketplaces: MasterProduct['marketplaces'] }
