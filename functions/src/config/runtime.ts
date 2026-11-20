import { defineInt, defineSecret, defineString } from 'firebase-functions/params';

export const FAL_KEY = defineSecret('FAL_KEY');
export const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
export const GOOGLE_PRIVATE_KEY = defineSecret('GOOGLE_PRIVATE_KEY');
export const GMAIL_OAUTH_CLIENT = defineSecret('GMAIL_OAUTH_CLIENT');

const BATCH_MAX_JOBS = defineInt('BATCH_MAX_JOBS', { default: 100 });
const JOB_MAX_RETRIES = defineInt('JOB_MAX_RETRIES', { default: 3 });
const JOB_TIMEOUT_MS = defineInt('JOB_TIMEOUT_MS', { default: 8 * 60 * 1000 });
const JOB_STUCK_SWEEP_LIMIT = defineInt('JOB_STUCK_SWEEP_LIMIT', { default: 50 });
const JOB_RETRY_DELAY_MS = defineInt('JOB_RETRY_DELAY_MS', { default: 5 * 60 * 1000 });
const JOB_AUTO_REVIEW_MAX_ATTEMPTS = defineInt('JOB_AUTO_REVIEW_MAX_ATTEMPTS', { default: 3 });
const FAL_POLL_INTERVAL_MS = defineInt('FAL_POLL_INTERVAL_MS', { default: 2000 });
const FAL_POLL_TIMEOUT_MS = defineInt('FAL_POLL_TIMEOUT_MS', { default: 7 * 60 * 1000 });
const GEMINI_IMAGE_REVIEW_MODEL = defineString('GEMINI_IMAGE_REVIEW_MODEL', {
  default: 'gemini-3.1-flash-lite-preview',
});
const GEMINI_POSE_CLASSIFICATION_MODEL = defineString('GEMINI_POSE_CLASSIFICATION_MODEL', {
  default: 'gemini-3.1-flash-lite-preview',
});
// Marketplace base approval is a paid-generation gate: flash-lite mislabelled thigh-up crops as full_body and light
// grey as white on every real SHEIN base (2026-11-20), so the verifier uses a stronger model than routine pose tagging.
const GEMINI_MODEL_BASE_VERIFIER_MODEL = defineString('GEMINI_MODEL_BASE_VERIFIER_MODEL', {
  default: 'gemini-3.8-flash',
});
const GEMINI_GARMENT_VIEW_CLASSIFICATION_MODEL = defineString('GEMINI_GARMENT_VIEW_CLASSIFICATION_MODEL', {
  default: 'gemini-3.1-flash-lite-preview',
});
const GOOGLE_CLIENT_EMAIL = defineString('GOOGLE_CLIENT_EMAIL', { default: '' });
const GOOGLE_DRIVE_FOLDER_ID = defineString('GOOGLE_DRIVE_FOLDER_ID', { default: '' });
const GOOGLE_WORKSPACE_USER_EMAIL = defineString('GOOGLE_WORKSPACE_USER_EMAIL', { default: '' });

export const getBatchMaxJobs = (): number => BATCH_MAX_JOBS.value();
export const getJobMaxRetries = (): number => JOB_MAX_RETRIES.value();
export const getJobTimeoutMs = (): number => JOB_TIMEOUT_MS.value();
export const getJobStuckSweepLimit = (): number => JOB_STUCK_SWEEP_LIMIT.value();
export const getJobRetryDelayMs = (): number => JOB_RETRY_DELAY_MS.value();
export const getJobAutoReviewMaxAttempts = (): number => JOB_AUTO_REVIEW_MAX_ATTEMPTS.value();
export const getFalPollIntervalMs = (): number => FAL_POLL_INTERVAL_MS.value();
export const getFalPollTimeoutMs = (): number => FAL_POLL_TIMEOUT_MS.value();
export const getGeminiImageReviewModel = (): string => GEMINI_IMAGE_REVIEW_MODEL.value();
export const getGeminiPoseClassificationModel = (): string => GEMINI_POSE_CLASSIFICATION_MODEL.value();
export const getGeminiModelBaseVerifierModel = (): string => GEMINI_MODEL_BASE_VERIFIER_MODEL.value();
export const getGeminiGarmentViewClassificationModel = (): string => GEMINI_GARMENT_VIEW_CLASSIFICATION_MODEL.value();
export const getGoogleClientEmail = (): string => GOOGLE_CLIENT_EMAIL.value();
export const getGoogleDriveFolderId = (): string => GOOGLE_DRIVE_FOLDER_ID.value();
export const getGoogleWorkspaceUserEmail = (): string => GOOGLE_WORKSPACE_USER_EMAIL.value();
