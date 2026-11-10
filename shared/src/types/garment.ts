import type {
  GarmentAccessoryType,
  GarmentView,
  GarmentPhotoClassificationSource,
  GarmentSourceType,
  GarmentBodyArea,
  GenerationKind,
} from './common';

export type GarmentGender = 'male' | 'female' | 'unisex';

export interface GarmentPhotoAssetInput {
  id: string;
  fileName: string;
  storagePath: string;
  sourceIndex: number;
}

export interface UploadedGarmentPhotoInput extends GarmentPhotoAssetInput {
  isDetail?: boolean;
  view: GarmentView;
  confidence?: number | null;
  reasoning?: string | null;
  classifiedBy: GarmentPhotoClassificationSource;
}

export interface UploadedGarmentInput {
  photoAttributes?: Partial<import('./photoPlan').PhotoArticleAttributes>;
  photoProductId?: string;
  photoVariantId?: string;
  id: string;
  name: string;
  storagePath: string;
  isMultiAngle: boolean;
  sourceType?: GarmentSourceType;
  originalFileNames?: string[];
  originalPhotoCount?: number;
  photos?: UploadedGarmentPhotoInput[];
  garmentBodyArea?: GarmentBodyArea | null;
  garmentAccessoryType?: GarmentAccessoryType | null;
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
  photoAttributes?: Partial<import('./photoPlan').PhotoArticleAttributes>;
  garmentId: string;
  garmentName: string;
  photos: ClassifiedGarmentPhoto[];
  availableViews: GarmentView[];
  garmentBodyArea: GarmentBodyArea | null;
  garmentAccessoryType: GarmentAccessoryType | null;
  usedGemini: boolean;
  itemKind?: GenerationKind | null;
  itemKindConfidence?: number | null;
  itemKindReasoning?: string | null;
  itemLabel?: string | null;
  garmentGender?: GarmentGender | null;
  garmentGenderConfidence?: number | null;
  garmentGenderReasoning?: string | null;
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
