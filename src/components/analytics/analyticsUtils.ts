import type { GeminiUsageFeature, GeminiUsageStatus } from '../../../shared/src/types';

export const COLORS = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6'];

export const formatUsd = (value: unknown, digits: number = 2) => {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return amount.toFixed(digits);
};

export const formatTokenCount = (value: unknown) => {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('es-MX').format(Math.round(amount));
};

export const GEMINI_FEATURE_LABELS: Record<GeminiUsageFeature, string> = {
  image_review: 'Auto review',
  garment_view_classification: 'Clasif. prendas',
  garment_view_category_color_classification: 'Clasif. prendas + categoría/color',
  pose_classification: 'Tagging de poses',
  product_draft_enrichment: 'Drafts de producto',
  spreadsheet_source_matching: 'Matching spreadsheet fuente',
};

export const GEMINI_STATUS_LABELS: Record<GeminiUsageStatus, string> = {
  success: 'OK',
  error: 'Error',
};
