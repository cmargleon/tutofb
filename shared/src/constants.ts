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
