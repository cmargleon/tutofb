import { defineInt, defineSecret, defineString } from 'firebase-functions/params';

export const FAL_KEY = defineSecret('FAL_KEY');
export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
export const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const BATCH_MAX_JOBS = defineInt('BATCH_MAX_JOBS', { default: 100 });
const JOB_MAX_RETRIES = defineInt('JOB_MAX_RETRIES', { default: 3 });
const JOB_TIMEOUT_MS = defineInt('JOB_TIMEOUT_MS', { default: 5 * 60 * 1000 });
const JOB_STUCK_SWEEP_LIMIT = defineInt('JOB_STUCK_SWEEP_LIMIT', { default: 50 });
const JOB_AUTO_REVIEW_MAX_ATTEMPTS = defineInt('JOB_AUTO_REVIEW_MAX_ATTEMPTS', { default: 3 });
const FAL_POLL_INTERVAL_MS = defineInt('FAL_POLL_INTERVAL_MS', { default: 2000 });
const FAL_POLL_TIMEOUT_MS = defineInt('FAL_POLL_TIMEOUT_MS', { default: 4 * 60 * 1000 });
const OPENAI_BASE_URL = defineString('OPENAI_BASE_URL', { default: 'https://api.openai.com/v1' });
const GEMINI_IMAGE_REVIEW_MODEL = defineString('GEMINI_IMAGE_REVIEW_MODEL', {
  default: 'gemini-3.1-flash-lite-preview',
});
const GEMINI_POSE_CLASSIFICATION_MODEL = defineString('GEMINI_POSE_CLASSIFICATION_MODEL', {
  default: 'gemini-3.1-flash-lite-preview',
});
const GEMINI_GARMENT_VIEW_CLASSIFICATION_MODEL = defineString('GEMINI_GARMENT_VIEW_CLASSIFICATION_MODEL', {
  default: 'gemini-3.1-flash-lite-preview',
});

export const getBatchMaxJobs = (): number => BATCH_MAX_JOBS.value();
export const getJobMaxRetries = (): number => JOB_MAX_RETRIES.value();
export const getJobTimeoutMs = (): number => JOB_TIMEOUT_MS.value();
export const getJobStuckSweepLimit = (): number => JOB_STUCK_SWEEP_LIMIT.value();
export const getJobAutoReviewMaxAttempts = (): number => JOB_AUTO_REVIEW_MAX_ATTEMPTS.value();
export const getFalPollIntervalMs = (): number => FAL_POLL_INTERVAL_MS.value();
export const getFalPollTimeoutMs = (): number => FAL_POLL_TIMEOUT_MS.value();
export const getOpenAIBaseUrl = (): string => OPENAI_BASE_URL.value();
export const getGeminiImageReviewModel = (): string => GEMINI_IMAGE_REVIEW_MODEL.value();
export const getGeminiPoseClassificationModel = (): string => GEMINI_POSE_CLASSIFICATION_MODEL.value();
export const getGeminiGarmentViewClassificationModel = (): string => GEMINI_GARMENT_VIEW_CLASSIFICATION_MODEL.value();
