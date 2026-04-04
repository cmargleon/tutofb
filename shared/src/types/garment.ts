import type { GarmentView, GarmentPhotoClassificationSource, GarmentSourceType, GarmentBodyArea } from './common';

export interface GarmentPhotoAssetInput {
  id: string;
  fileName: string;
  storagePath: string;
  sourceIndex: number;
}

export interface UploadedGarmentPhotoInput extends GarmentPhotoAssetInput {
  view: GarmentView;
  confidence?: number | null;
  reasoning?: string | null;
  classifiedBy: GarmentPhotoClassificationSource;
}

export interface UploadedGarmentInput {
  id: string;
  name: string;
  storagePath: string;
  isMultiAngle: boolean;
  sourceType?: GarmentSourceType;
  originalFileNames?: string[];
  originalPhotoCount?: number;
  photos?: UploadedGarmentPhotoInput[];
  garmentBodyArea?: GarmentBodyArea | null;
  matchedCategoryId?: string | null;
  matchedCategoryLabel?: string | null;
  matchedCategoryConfidence?: number | null;
  matchedCategoryReasoning?: string | null;
  matchedColor?: string | null;
  matchedColorConfidence?: number | null;
  matchedColorReasoning?: string | null;
}

export interface ClassifyGarmentViewsGarmentInput {
  garmentId: string;
  garmentName: string;
  photos: GarmentPhotoAssetInput[];
}

export interface ClassifyGarmentViewsRequest {
  clientId?: string | null;
  spreadsheetTemplateId?: string | null;
  fallbackCategoryId?: string | null;
  garments: ClassifyGarmentViewsGarmentInput[];
}

export interface ClassifiedGarmentPhoto extends UploadedGarmentPhotoInput {
  bodyArea?: GarmentBodyArea | null;
}

export interface ClassifiedGarmentViewsGarmentResult {
  garmentId: string;
  garmentName: string;
  photos: ClassifiedGarmentPhoto[];
  availableViews: GarmentView[];
  garmentBodyArea: GarmentBodyArea | null;
  usedGemini: boolean;
  matchedCategoryId?: string | null;
  matchedCategoryLabel?: string | null;
  matchedCategoryConfidence?: number | null;
  matchedCategoryReasoning?: string | null;
  matchedColor?: string | null;
  matchedColorConfidence?: number | null;
  matchedColorReasoning?: string | null;
}

export interface ClassifyGarmentViewsResponse {
  success: boolean;
  garments: ClassifiedGarmentViewsGarmentResult[];
}
