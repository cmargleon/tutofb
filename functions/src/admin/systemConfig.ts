import {
  DEFAULT_TRY_ON_PROMPT_CASES,
} from '../../../shared/src/domain';
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
  systemPromptFullOutfit: DEFAULT_TRY_ON_PROMPT_CASES.full_outfit,
  systemPromptTopOnly: DEFAULT_TRY_ON_PROMPT_CASES.top_only,
  systemPromptBottomOnly: DEFAULT_TRY_ON_PROMPT_CASES.bottom_only,
};

const normalizePromptOverride = (value: unknown, fallback: string): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export const sanitizeSystemConfig = (input: Partial<SystemConfig> | null | undefined): SystemConfig => ({
  jobMaxRetries: typeof input?.jobMaxRetries === 'number' && input.jobMaxRetries >= 0 ? Math.round(input.jobMaxRetries) : DEFAULT_SYSTEM_CONFIG.jobMaxRetries,
  jobRetryDelayMs: typeof input?.jobRetryDelayMs === 'number' && input.jobRetryDelayMs >= 0 ? Math.round(input.jobRetryDelayMs) : DEFAULT_SYSTEM_CONFIG.jobRetryDelayMs,
  batchMaxJobs: typeof input?.batchMaxJobs === 'number' && input.batchMaxJobs >= 1 ? Math.round(input.batchMaxJobs) : DEFAULT_SYSTEM_CONFIG.batchMaxJobs,
  geminiImageReviewModel: typeof input?.geminiImageReviewModel === 'string' && input.geminiImageReviewModel.trim() ? input.geminiImageReviewModel.trim() : DEFAULT_SYSTEM_CONFIG.geminiImageReviewModel,
  disabledProviders: Array.isArray(input?.disabledProviders) ? input.disabledProviders.filter((p) => typeof p === 'string') : [],
  systemPromptOverride: typeof input?.systemPromptOverride === 'string' && input.systemPromptOverride.trim() ? input.systemPromptOverride.trim() : null,
  systemPromptFullOutfit: normalizePromptOverride(input?.systemPromptFullOutfit, DEFAULT_SYSTEM_CONFIG.systemPromptFullOutfit!),
  systemPromptTopOnly: normalizePromptOverride(input?.systemPromptTopOnly, DEFAULT_SYSTEM_CONFIG.systemPromptTopOnly!),
  systemPromptBottomOnly: normalizePromptOverride(input?.systemPromptBottomOnly, DEFAULT_SYSTEM_CONFIG.systemPromptBottomOnly!),
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
