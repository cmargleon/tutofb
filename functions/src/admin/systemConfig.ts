import { DEFAULT_AUTOMATION_BUDGET, validateAutomationBudget } from '../../../shared/src/automationPolicy';
import {
  DEFAULT_TRY_ON_PROMPT_CASES,
} from '../../../shared/src/domain';
import { Provider, SystemConfig } from '../../../shared/src/types';
import { ADDITIONAL_SYSTEM_PROMPT_FIELDS, normalizeAdditionalSystemPrompts } from '../../../shared/src/systemPrompts';
import { PRODUCT_SCENES } from '../../../shared/src/productGeneration';
import { HttpsError } from 'firebase-functions/v2/https';
import { getAppFirestore } from '../firebase/appFirestore';
import { getJobMaxRetries, getJobRetryDelayMs, getBatchMaxJobs, getGeminiImageReviewModel } from '../config/runtime';

const CONFIG_COLLECTION = 'system_config';
const CONFIG_DOC_ID = 'main';

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  automationBudget: DEFAULT_AUTOMATION_BUDGET,
  jobMaxRetries: getJobMaxRetries(),
  jobRetryDelayMs: getJobRetryDelayMs(),
  batchMaxJobs: getBatchMaxJobs(),
  geminiImageReviewModel: getGeminiImageReviewModel(),
  disabledProviders: [],
  systemPromptOverride: null,
  systemPromptFullOutfit: DEFAULT_TRY_ON_PROMPT_CASES.full_outfit,
  systemPromptTopOnly: DEFAULT_TRY_ON_PROMPT_CASES.top_only,
  systemPromptBottomOnly: DEFAULT_TRY_ON_PROMPT_CASES.bottom_only,
  ...normalizeAdditionalSystemPrompts(),
};

const normalizePromptOverride = (value: unknown, fallback: string): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export const assertValidAdditionalSystemPrompts = (input: Partial<SystemConfig>) => {
  const validate = (value: unknown, label: string, maxLength: number) => {
    if (value != null && (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) {
      throw new HttpsError('invalid-argument', `${label}: usa texto válido de hasta ${maxLength} caracteres.`);
    }
  };
  for (const { key, label, maxLength } of ADDITIONAL_SYSTEM_PROMPT_FIELDS) validate(input[key], label, maxLength);
  const scenes = input.systemProductScenePrompts;
  if (scenes != null) {
    if (typeof scenes !== 'object' || Array.isArray(scenes)) throw new HttpsError('invalid-argument', 'Prompts de escenas inválidos.');
    for (const [type, value] of Object.entries(scenes)) {
      const scene = PRODUCT_SCENES.find((preset) => preset.type === type);
      if (!scene) throw new HttpsError('invalid-argument', 'Escena desconocida.');
      validate(value, scene.label, 4000);
    }
  }
};

// A malformed automation-only document must not break the manual generation configuration.
const readAutomationBudget = (input: SystemConfig['automationBudget']) => {
  try { return validateAutomationBudget(input ?? DEFAULT_AUTOMATION_BUDGET); }
  catch { return { ...DEFAULT_AUTOMATION_BUDGET }; }
};

export const sanitizeSystemConfig = (input: Partial<SystemConfig> | null | undefined): SystemConfig => ({
  automationBudget: readAutomationBudget(input?.automationBudget),
  jobMaxRetries: typeof input?.jobMaxRetries === 'number' && input.jobMaxRetries >= 0 ? Math.round(input.jobMaxRetries) : DEFAULT_SYSTEM_CONFIG.jobMaxRetries,
  jobRetryDelayMs: typeof input?.jobRetryDelayMs === 'number' && input.jobRetryDelayMs >= 0 ? Math.round(input.jobRetryDelayMs) : DEFAULT_SYSTEM_CONFIG.jobRetryDelayMs,
  batchMaxJobs: typeof input?.batchMaxJobs === 'number' && input.batchMaxJobs >= 1 ? Math.round(input.batchMaxJobs) : DEFAULT_SYSTEM_CONFIG.batchMaxJobs,
  geminiImageReviewModel: typeof input?.geminiImageReviewModel === 'string' && input.geminiImageReviewModel.trim() ? input.geminiImageReviewModel.trim() : DEFAULT_SYSTEM_CONFIG.geminiImageReviewModel,
  disabledProviders: Array.isArray(input?.disabledProviders) ? input.disabledProviders.filter((p) => typeof p === 'string') : [],
  systemPromptOverride: typeof input?.systemPromptOverride === 'string' && input.systemPromptOverride.trim() ? input.systemPromptOverride.trim() : null,
  systemPromptFullOutfit: normalizePromptOverride(input?.systemPromptFullOutfit, DEFAULT_SYSTEM_CONFIG.systemPromptFullOutfit!),
  systemPromptTopOnly: normalizePromptOverride(input?.systemPromptTopOnly, DEFAULT_SYSTEM_CONFIG.systemPromptTopOnly!),
  systemPromptBottomOnly: normalizePromptOverride(input?.systemPromptBottomOnly, DEFAULT_SYSTEM_CONFIG.systemPromptBottomOnly!),
  ...normalizeAdditionalSystemPrompts(input),
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

export const isProviderDisabledInSystemConfig = (
  provider: Provider,
  systemConfig: Pick<SystemConfig, 'disabledProviders'>,
): boolean => systemConfig.disabledProviders.includes(provider);

export const assertProviderEnabledInSystemConfig = (
  provider: Provider,
  systemConfig: Pick<SystemConfig, 'disabledProviders'>,
  actionLabel = 'usar este modelo',
) => {
  if (provider === 'openai-gpt-image-1.5') {
    throw new HttpsError('failed-precondition', 'La generación directa con OpenAI fue retirada. Selecciona un modelo de fal.ai.');
  }
  if (isProviderDisabledInSystemConfig(provider, systemConfig)) {
    throw new HttpsError(
      'failed-precondition',
      `El modelo seleccionado está deshabilitado en Configuración y no se puede ${actionLabel}.`,
    );
  }
};
