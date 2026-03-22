"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGeminiImageReviewModel = exports.getOpenAIBaseUrl = exports.getFalPollTimeoutMs = exports.getFalPollIntervalMs = exports.getJobAutoReviewMaxAttempts = exports.getJobStuckSweepLimit = exports.getJobTimeoutMs = exports.getJobMaxRetries = exports.getBatchMaxJobs = exports.GEMINI_API_KEY = exports.OPENAI_API_KEY = exports.FAL_KEY = void 0;
const params_1 = require("firebase-functions/params");
exports.FAL_KEY = (0, params_1.defineSecret)('FAL_KEY');
exports.OPENAI_API_KEY = (0, params_1.defineSecret)('OPENAI_API_KEY');
exports.GEMINI_API_KEY = (0, params_1.defineSecret)('GEMINI_API_KEY');
const BATCH_MAX_JOBS = (0, params_1.defineInt)('BATCH_MAX_JOBS', { default: 100 });
const JOB_MAX_RETRIES = (0, params_1.defineInt)('JOB_MAX_RETRIES', { default: 3 });
const JOB_TIMEOUT_MS = (0, params_1.defineInt)('JOB_TIMEOUT_MS', { default: 5 * 60 * 1000 });
const JOB_STUCK_SWEEP_LIMIT = (0, params_1.defineInt)('JOB_STUCK_SWEEP_LIMIT', { default: 50 });
const JOB_AUTO_REVIEW_MAX_ATTEMPTS = (0, params_1.defineInt)('JOB_AUTO_REVIEW_MAX_ATTEMPTS', { default: 3 });
const FAL_POLL_INTERVAL_MS = (0, params_1.defineInt)('FAL_POLL_INTERVAL_MS', { default: 2000 });
const FAL_POLL_TIMEOUT_MS = (0, params_1.defineInt)('FAL_POLL_TIMEOUT_MS', { default: 4 * 60 * 1000 });
const OPENAI_BASE_URL = (0, params_1.defineString)('OPENAI_BASE_URL', { default: 'https://api.openai.com/v1' });
const GEMINI_IMAGE_REVIEW_MODEL = (0, params_1.defineString)('GEMINI_IMAGE_REVIEW_MODEL', {
    default: 'gemini-3.1-flash-lite-preview',
});
const getBatchMaxJobs = () => BATCH_MAX_JOBS.value();
exports.getBatchMaxJobs = getBatchMaxJobs;
const getJobMaxRetries = () => JOB_MAX_RETRIES.value();
exports.getJobMaxRetries = getJobMaxRetries;
const getJobTimeoutMs = () => JOB_TIMEOUT_MS.value();
exports.getJobTimeoutMs = getJobTimeoutMs;
const getJobStuckSweepLimit = () => JOB_STUCK_SWEEP_LIMIT.value();
exports.getJobStuckSweepLimit = getJobStuckSweepLimit;
const getJobAutoReviewMaxAttempts = () => JOB_AUTO_REVIEW_MAX_ATTEMPTS.value();
exports.getJobAutoReviewMaxAttempts = getJobAutoReviewMaxAttempts;
const getFalPollIntervalMs = () => FAL_POLL_INTERVAL_MS.value();
exports.getFalPollIntervalMs = getFalPollIntervalMs;
const getFalPollTimeoutMs = () => FAL_POLL_TIMEOUT_MS.value();
exports.getFalPollTimeoutMs = getFalPollTimeoutMs;
const getOpenAIBaseUrl = () => OPENAI_BASE_URL.value();
exports.getOpenAIBaseUrl = getOpenAIBaseUrl;
const getGeminiImageReviewModel = () => GEMINI_IMAGE_REVIEW_MODEL.value();
exports.getGeminiImageReviewModel = getGeminiImageReviewModel;
//# sourceMappingURL=runtime.js.map