import { defineInt, defineSecret, defineString } from 'firebase-functions/params';

export const FAL_KEY = defineSecret('FAL_KEY');
export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

const BATCH_MAX_JOBS = defineInt('BATCH_MAX_JOBS', { default: 100 });
const JOB_MAX_RETRIES = defineInt('JOB_MAX_RETRIES', { default: 3 });
const JOB_TIMEOUT_MS = defineInt('JOB_TIMEOUT_MS', { default: 5 * 60 * 1000 });
const JOB_STUCK_SWEEP_LIMIT = defineInt('JOB_STUCK_SWEEP_LIMIT', { default: 50 });
const FAL_POLL_INTERVAL_MS = defineInt('FAL_POLL_INTERVAL_MS', { default: 2000 });
const FAL_POLL_TIMEOUT_MS = defineInt('FAL_POLL_TIMEOUT_MS', { default: 4 * 60 * 1000 });
const OPENAI_BASE_URL = defineString('OPENAI_BASE_URL', { default: 'https://api.openai.com/v1' });

export const getBatchMaxJobs = (): number => BATCH_MAX_JOBS.value();
export const getJobMaxRetries = (): number => JOB_MAX_RETRIES.value();
export const getJobTimeoutMs = (): number => JOB_TIMEOUT_MS.value();
export const getJobStuckSweepLimit = (): number => JOB_STUCK_SWEEP_LIMIT.value();
export const getFalPollIntervalMs = (): number => FAL_POLL_INTERVAL_MS.value();
export const getFalPollTimeoutMs = (): number => FAL_POLL_TIMEOUT_MS.value();
export const getOpenAIBaseUrl = (): string => OPENAI_BASE_URL.value();
