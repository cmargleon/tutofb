import { SystemConfig } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { getJobMaxRetries, getJobRetryDelayMs, getBatchMaxJobs, getGeminiImageReviewModel } from '../config/runtime';

const CONFIG_COLLECTION = 'system_config';
const CONFIG_DOC_ID = 'main';

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  jobMaxRetries: getJobMaxRetries(),
  jobRetryDelayMs: getJobRetryDelayMs(),
  batchMaxJobs: getBatchMaxJobs(),
  geminiImageReviewModel: getGeminiImageReviewModel(),
  disabledProviders: [],
  systemPromptOverride: null,
};

export const sanitizeSystemConfig = (input: Partial<SystemConfig> | null | undefined): SystemConfig => ({
  jobMaxRetries: typeof input?.jobMaxRetries === 'number' && input.jobMaxRetries >= 0 ? Math.round(input.jobMaxRetries) : DEFAULT_SYSTEM_CONFIG.jobMaxRetries,
  jobRetryDelayMs: typeof input?.jobRetryDelayMs === 'number' && input.jobRetryDelayMs >= 0 ? Math.round(input.jobRetryDelayMs) : DEFAULT_SYSTEM_CONFIG.jobRetryDelayMs,
  batchMaxJobs: typeof input?.batchMaxJobs === 'number' && input.batchMaxJobs >= 1 ? Math.round(input.batchMaxJobs) : DEFAULT_SYSTEM_CONFIG.batchMaxJobs,
  geminiImageReviewModel: typeof input?.geminiImageReviewModel === 'string' && input.geminiImageReviewModel.trim() ? input.geminiImageReviewModel.trim() : DEFAULT_SYSTEM_CONFIG.geminiImageReviewModel,
  disabledProviders: Array.isArray(input?.disabledProviders) ? input.disabledProviders.filter((p) => typeof p === 'string') : [],
  systemPromptOverride: typeof input?.systemPromptOverride === 'string' && input.systemPromptOverride.trim() ? input.systemPromptOverride.trim() : null,
});

export const getSystemConfigDocRef = () =>
  getAppFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID);

// Module-level cache with 5-minute TTL (works across warm invocations)
let _cachedConfig: SystemConfig | null = null;
let _cacheExpiresAt = 0;

export const getSystemConfigCached = async (): Promise<SystemConfig> => {
  const now = Date.now();
  if (_cachedConfig && now < _cacheExpiresAt) {
    return _cachedConfig;
  }
  const snapshot = await getSystemConfigDocRef().get();
  _cachedConfig = snapshot.exists
    ? sanitizeSystemConfig(snapshot.data() as Partial<SystemConfig>)
    : { ...DEFAULT_SYSTEM_CONFIG };
  _cacheExpiresAt = now + 5 * 60 * 1000;
  return _cachedConfig;
};

export const invalidateSystemConfigCache = () => {
  _cachedConfig = null;
  _cacheExpiresAt = 0;
};
