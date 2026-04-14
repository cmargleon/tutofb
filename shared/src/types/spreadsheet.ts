import type { TimestampLike, SpreadsheetTemplateImportStatus, ProductDraftSuggestionSource } from './common';
import type { UploadedGarmentInput } from './garment';
import type { PoseFraming, PoseOrientationDetail, PoseOrientationGroup } from './common';

export interface SpreadsheetTemplateCategorySummary {
  id: string;
  sheetName: string;
  label: string;
  columnCount: number;
  attributeCount: number;
  rowStart: number;
}

export interface SpreadsheetTemplateOriginOption {
  label: string;
  code: string;
}

export interface SpreadsheetTemplate {
  id?: string;
  clientId: string;
  clientNameSnapshot: string;
  name: string;
  originalFileName: string;
  storagePath: string;
  mimeType: string;
  status?: SpreadsheetTemplateImportStatus;
  archivedAt?: TimestampLike | null;
  archivedByUid?: string | null;
  parserVersion: number;
  templateFingerprint: string;
  categoryIds: string[];
  categories: SpreadsheetTemplateCategorySummary[];
  defaultCategoryId?: string | null;
  defaultCategoryLabel?: string | null;
  brandOptions: string[];
  originOptions: SpreadsheetTemplateOriginOption[];
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  createdByUid: string;
}

export interface SpreadsheetTemplateCategoryColumn {
  index: number;
  letter: string;
  label: string;
  key: string;
  required: boolean;
  requirementLabel: string | null;
  guidance: string | null;
  validation: string | null;
  dropdownOptions?: string[];
  dropdownFormula?: string | null;
}

export interface SpreadsheetTemplateCategoryAttribute {
  attributeType: string | null;
  name: string;
  required: boolean;
  important: boolean;
  values: string[];
}

export interface SpreadsheetTemplateCategory {
  id?: string;
  templateId: string;
  clientId: string;
  sheetName: string;
  label: string;
  rowStart: number;
  columns: SpreadsheetTemplateCategoryColumn[];
  attributes: SpreadsheetTemplateCategoryAttribute[];
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

export interface ProductDraftValueSuggestion {
  value: string;
  confidence: number | null;
  reasoning: string | null;
  source: ProductDraftSuggestionSource;
}

export interface ProductDraftRow {
  id: string;
  values: Record<string, string>;
}

export interface ProductDraftGeneratedImage {
  jobId: string;
  outputId: string;
  poseId: string | null;
  label: string;
  storagePath: string;
  downloadUrl: string | null;
  poseOrientationGroup?: PoseOrientationGroup | null;
  poseOrientationDetail?: PoseOrientationDetail | null;
  poseFraming?: PoseFraming | null;
  selectedAt: TimestampLike;
}

export interface ProductDraftOriginalImage {
  photoId: string;
  fileName: string;
  storagePath: string;
  view: string | null;
  sourceIndex: number;
}

export interface ProductDraft {
  id?: string;
  batchId: string;
  clientId: string;
  clientNameSnapshot: string;
  modelId: string;
  modelNameSnapshot: string;
  templateId: string;
  templateNameSnapshot: string;
  categoryId: string;
  categoryNameSnapshot: string;
  garmentId: string;
  garmentName: string;
  garmentFilePath: string;
  garmentPhotoId?: string | null;
  garmentPhotoFileName?: string | null;
  matchedColor?: string | null;
  inferredValues: Record<string, ProductDraftValueSuggestion>;
  rows: ProductDraftRow[];
  originalImages: ProductDraftOriginalImage[];
  generatedImages: ProductDraftGeneratedImage[];
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  createdByUid: string;
  updatedByUid: string | null;
}

export interface ProductDraftInput {
  garmentId: string;
  garmentName: string;
  categoryId: string;
  categoryName: string;
  matchedColor?: string | null;
  rows: ProductDraftRow[];
  inferredValues?: Record<string, ProductDraftValueSuggestion>;
}

export interface WizardSourceSpreadsheetInput {
  storagePath: string;
  originalFileName: string;
}

export interface SourceSpreadsheetMatchSummary {
  totalRows: number;
  rowsWithPhotos: number;
  ignoredRows: number;
  reusedSpuPhotoRows: number;
  matchedRows: number;
  matchedGarments: number;
  unmatchedGarments: number;
}

export interface PreviewProductDraftsRequest {
  clientId: string;
  modelId: string;
  spreadsheetTemplateId: string;
  fallbackCategoryId?: string | null;
  garments: UploadedGarmentInput[];
  sourceSpreadsheet?: WizardSourceSpreadsheetInput | null;
}

export interface PreviewProductDraftsResponse {
  success: boolean;
  productDrafts: ProductDraftInput[];
  sourceSpreadsheetSummary?: SourceSpreadsheetMatchSummary | null;
}

export interface ImportClientSpreadsheetTemplateRequest {
  clientId: string;
  storagePath: string;
  originalFileName: string;
}

export interface ImportClientSpreadsheetTemplateResponse {
  success: boolean;
  templateId: string;
  categoryCount: number;
  defaultCategoryId: string | null;
}

export interface UpdateClientSpreadsheetTemplateCategoryRequest {
  clientId: string;
  templateId: string;
  categoryId: string | null;
}

export interface UpdateClientSpreadsheetTemplateCategoryResponse {
  success: boolean;
  templateId: string;
  categoryId: string | null;
}

export interface DeleteClientSpreadsheetTemplateRequest {
  clientId: string;
  templateId: string;
}

export interface DeleteClientSpreadsheetTemplateResponse {
  success: boolean;
  templateId: string;
}
