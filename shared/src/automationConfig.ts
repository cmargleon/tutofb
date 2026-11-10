import type { AutomationRules, Client, ClientAutomationConfig, CreateAutomationJobRequest, Model, SystemConfig } from './types';
import { DEFAULT_ORGANIZER_AUTO_GENERATION_ENABLED } from './types/organizer';
import { DEFAULT_AUTOMATION_BUDGET, resolveAutomationPolicy } from './automationPolicy';
import { getClientGenderModelDefaults } from './automationModels';

export const DEFAULT_AUTOMATION_RULES: AutomationRules = {
  garmentGenderMinConfidence: 0.65,
  classificationMinConfidence: 0.65,
};

export const validateAutomationRules = (partial: Partial<AutomationRules>): Partial<AutomationRules> => {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new Error('Las reglas de automatización deben ser un objeto con umbrales de confianza.');
  }
  const result: Partial<AutomationRules> = {};
  for (const key of Object.keys(DEFAULT_AUTOMATION_RULES) as Array<keyof AutomationRules>) {
    const value = partial[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 0.95) {
      const label = key === 'garmentGenderMinConfidence' ? 'género de la prenda' : 'clasificación';
      throw new Error(`El umbral de ${label} debe ser un número finito entre 0.5 y 0.95.`);
    }
    result[key] = value;
  }
  return result;
};

export const resolveAutomationRules = (
  system?: Partial<AutomationRules>, client?: Partial<AutomationRules>,
): AutomationRules => ({
  garmentGenderMinConfidence: client?.garmentGenderMinConfidence ?? system?.garmentGenderMinConfidence ?? DEFAULT_AUTOMATION_RULES.garmentGenderMinConfidence,
  classificationMinConfidence: client?.classificationMinConfidence ?? system?.classificationMinConfidence ?? DEFAULT_AUTOMATION_RULES.classificationMinConfidence,
});

export type AutomationConfigSource = 'cliente' | 'sistema' | 'predeterminado';
export type EffectiveAutomationValue<T> = { value: T; source: AutomationConfigSource };
const effective = <T>(client: T | undefined, system: T | undefined, fallback: T): EffectiveAutomationValue<T> => ({
  value: client ?? system ?? fallback,
  source: client != null ? 'cliente' : system != null ? 'sistema' : 'predeterminado',
});
const defaultPresetByType = 'Según tipo: standard (prendas) / generic_product (objetos)';
export const resolveAutomationPresetName = (
  request: Pick<CreateAutomationJobRequest, 'jobType' | 'preset'>, client?: ClientAutomationConfig,
): string => request.preset || client?.defaultPreset || (request.jobType === 'product' ? 'generic_product' : 'standard');

/** Read-only explanation of the same defaults used when an automation is created. */
export const resolveEffectiveAutomationConfig = ({ system, client, models = [] }: {
  system?: Partial<SystemConfig>;
  client: Pick<Client, 'id' | 'automation' | 'status'>;
  models?: Model[];
}) => {
  const config = client.automation;
  const issues: string[] = [];
  const budgetUsd = effective(config?.defaultBudgetUsd, system?.automationBudget?.defaultBudgetUsd, DEFAULT_AUTOMATION_BUDGET.defaultBudgetUsd);
  const maxReviewAttempts = effective(config?.maxReviewAttempts, system?.automationBudget?.maxReviewAttempts, DEFAULT_AUTOMATION_BUDGET.maxReviewAttempts);
  const maxOperationalRetries = effective(config?.maxOperationalRetries, system?.automationBudget?.maxOperationalRetries, DEFAULT_AUTOMATION_BUDGET.maxOperationalRetries);
  try {
    const policy = resolveAutomationPolicy(system?.automationBudget, config);
    budgetUsd.value = policy.budgetUsd;
    maxReviewAttempts.value = policy.maxReviewAttempts;
    maxOperationalRetries.value = policy.maxOperationalRetries;
  } catch (error) {
    issues.push((error as Error).message);
  }
  const garmentPreset = resolveAutomationPresetName({ jobType: 'garment' }, config);
  const productPreset = resolveAutomationPresetName({ jobType: 'product' }, config);
  const defaultPreset = effective(config?.defaultPreset || undefined, undefined, garmentPreset === productPreset ? garmentPreset : defaultPresetByType);
  const organizerGenerationPreset = effective(config?.organizerGeneration?.preset || undefined, undefined, defaultPreset.value);
  if (!config?.organizerGeneration?.preset) organizerGenerationPreset.source = defaultPreset.source;
  for (const name of new Set([config?.defaultPreset, config?.organizerGeneration?.preset])) {
    if (name && !['standard', 'generic_product'].includes(name) && !Object.hasOwn(config?.presets ?? {}, name)) {
      issues.push(`El preset «${name}» no está disponible. Revísalo en Cliente → Automatizaciones.`);
    }
  }
  const genderDefaults = getClientGenderModelDefaults(client.id ?? '', config, models);
  const presetModelId = config?.presets?.[config.organizerGeneration?.preset || garmentPreset]?.modelId;
  const fallbackModelId = !genderDefaults.defaultMaleModelId && !genderDefaults.defaultFemaleModelId ? config?.defaultModelId : undefined;
  const maleModelId = effective(presetModelId || config?.defaultMaleModelId || fallbackModelId, undefined, genderDefaults.defaultMaleModelId ?? null);
  const femaleModelId = effective(presetModelId || config?.defaultFemaleModelId || fallbackModelId, undefined, genderDefaults.defaultFemaleModelId ?? null);
  const rules = resolveAutomationRules(system?.automationRules, config?.rules);
  const garmentGenderMinConfidence = effective(config?.rules?.garmentGenderMinConfidence, system?.automationRules?.garmentGenderMinConfidence, rules.garmentGenderMinConfidence);
  const classificationMinConfidence = effective(config?.rules?.classificationMinConfidence, system?.automationRules?.classificationMinConfidence, rules.classificationMinConfidence);
  try { validateAutomationRules(rules); } catch (error) { issues.push((error as Error).message); }
  const globalEnabled = system?.organizerAutoGenerationEnabled ?? DEFAULT_ORGANIZER_AUTO_GENERATION_ENABLED;
  const organizerGenerationEnabled = effective(config?.organizerGeneration?.enabled, system?.organizerAutoGenerationEnabled, DEFAULT_ORGANIZER_AUTO_GENERATION_ENABLED);
  if (!globalEnabled) { organizerGenerationEnabled.value = false; organizerGenerationEnabled.source = 'sistema'; }
  if (config?.enabled === false || client.status === 'archived') {
    organizerGenerationEnabled.value = false;
    organizerGenerationEnabled.source = 'cliente';
  }
  return { budgetUsd, maxReviewAttempts, maxOperationalRetries, defaultPreset, maleModelId, femaleModelId,
    garmentGenderMinConfidence, classificationMinConfidence, organizerGenerationEnabled, organizerGenerationPreset, issues };
};
