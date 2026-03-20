export const ROLES = {
  ADMIN: 'admin',
  OPERADOR: 'operador',
  REVISOR: 'revisor',
} as const;

export const BATCH_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  PARTIAL_FAILED: 'partial_failed',
  FAILED: 'failed',
} as const;

export const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const PROVIDERS = {
  FAL_SEEDREAM: 'fal-seedream',
  FAL_BANANA_PRO: 'fal-banana-pro',
  OPENAI_GPT_IMAGE_1_5: 'openai-gpt-image-1.5',
} as const;

export const ASPECT_RATIOS = {
  STORY: '9:16',
  CATALOGO: '3:4',
  PORTRAIT: '2:3',
  SQUARE: '1:1',
  LANDSCAPE_CLASSIC: '4:3',
  LANDSCAPE_EDITORIAL: '3:2',
  HERO: '16:9',
} as const;
