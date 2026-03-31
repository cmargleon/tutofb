import type { GarmentView, GarmentPhotoClassificationSource, GarmentSourceType } from './common';

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
}

export interface ClassifyGarmentViewsGarmentInput {
  garmentId: string;
  garmentName: string;
  photos: GarmentPhotoAssetInput[];
}

export interface ClassifyGarmentViewsRequest {
  garments: ClassifyGarmentViewsGarmentInput[];
}

export interface ClassifiedGarmentPhoto extends UploadedGarmentPhotoInput {}

export interface ClassifiedGarmentViewsGarmentResult {
  garmentId: string;
  garmentName: string;
  photos: ClassifiedGarmentPhoto[];
  availableViews: GarmentView[];
  usedGemini: boolean;
}

export interface ClassifyGarmentViewsResponse {
  success: boolean;
  garments: ClassifiedGarmentViewsGarmentResult[];
}
