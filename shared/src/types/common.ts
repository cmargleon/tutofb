export type TimestampLike = any;

export type Role = 'admin' | 'operador' | 'revisor';
export type Provider = 'fal-seedream' | 'fal-banana-pro' | 'openai-gpt-image-1.5' | 'fal-nano-banana-2' | 'fal-seedream-5';
export type BatchOutputMode = 'spreadsheet' | 'photos_only';
export type AspectRatio = '9:16' | '3:4' | '2:3' | '1:1' | '4:3' | '3:2' | '16:9';
export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type GarmentSourceType = 'single' | 'folder-root' | 'subfolder';
export type CatalogEntityStatus = 'active' | 'archived';
export type GarmentView = 'front' | 'back' | 'side';
export type GarmentPhotoClassificationSource = 'assumed_single_front' | 'gemini';
export type GarmentReferenceImageType = 'single_view' | 'multi_angle_composite';
export type TryOnPromptCaseKey = 'full_outfit' | 'top_only' | 'bottom_only';
export type PoseOrientationGroup = 'front' | 'back' | 'side' | 'ambiguous';
export type SpreadsheetTemplateImportStatus = 'active' | 'archived';
export type ProductDraftSuggestionSource = 'gemini' | 'wizard' | 'system' | 'user';
export type PoseOrientationDetail =
  | 'front'
  | 'front_three_quarter'
  | 'back'
  | 'back_three_quarter'
  | 'left_profile'
  | 'right_profile'
  | 'ambiguous';
export type PoseFraming =
  | 'full_body'
  | 'three_quarter_body'
  | 'medium_body'
  | 'lower_body'
  | 'feet_closeup'
  | 'unknown';
export type PoseBodyFocus = 'full_body' | 'upper_body' | 'lower_body' | 'feet';
export type GarmentBodyArea = 'upper_body' | 'lower_body' | 'footwear' | 'head_accessory' | 'full_body';
export type HealthStatus = 'healthy' | 'degraded' | 'down';
