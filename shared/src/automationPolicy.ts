import type { AutomationBudgetState, AutomationBudgetConfig, AutomationPolicy, ClientAutomationConfig, CreateAutomationJobRequest } from './types';

export const DEFAULT_AUTOMATION_BUDGET: AutomationBudgetConfig = {
  defaultBudgetUsd: 10, maxBudgetUsd: 100, maxReviewAttempts: 3, maxOperationalRetries: 2,
};
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
export const validateAutomationBudget = (input: AutomationBudgetConfig): AutomationBudgetConfig => {
  if (!input || !positive(input.defaultBudgetUsd) || !positive(input.maxBudgetUsd)
    || input.defaultBudgetUsd > input.maxBudgetUsd || input.maxBudgetUsd > 10000
    || !Number.isInteger(input.maxReviewAttempts) || input.maxReviewAttempts < 1 || input.maxReviewAttempts > 10
    || !Number.isInteger(input.maxOperationalRetries) || input.maxOperationalRetries < 0 || input.maxOperationalRetries > 10
  ) throw new Error('Presupuesto de automatización inválido: USD positivos, default ≤ máximo, 1–10 intentos y 0–10 reintentos.');
  return { defaultBudgetUsd: input.defaultBudgetUsd, maxBudgetUsd: input.maxBudgetUsd,
    maxReviewAttempts: input.maxReviewAttempts, maxOperationalRetries: input.maxOperationalRetries };
};
/** Upper bound for a client's own maximum: the same ceiling the global validator accepts. */
export const CLIENT_MAX_BUDGET_LIMIT_USD = 10000;
/**
 * Maximum USD per automation job for a client: its own `maxBudgetUsd` when set (it may exceed the global
 * maximum, which stays unchanged for every other client), otherwise the global maximum.
 */
export const effectiveMaxBudgetUsd = (global: AutomationBudgetConfig = DEFAULT_AUTOMATION_BUDGET, client: Pick<ClientAutomationConfig, 'maxBudgetUsd'> = {}): number =>
  positive(client.maxBudgetUsd) && client.maxBudgetUsd <= CLIENT_MAX_BUDGET_LIMIT_USD ? client.maxBudgetUsd : global.maxBudgetUsd;
export const validateClientMaxBudget = (value: unknown, defaultBudgetUsd?: number): number => {
  if (!positive(value) || value > CLIENT_MAX_BUDGET_LIMIT_USD || Math.round(value * 100) !== value * 100)
    throw new Error(`El máximo por trabajo del cliente debe ser un importe en USD entre 0.01 y ${CLIENT_MAX_BUDGET_LIMIT_USD}.`);
  if (defaultBudgetUsd !== undefined && defaultBudgetUsd > value) throw new Error('El presupuesto predeterminado del cliente no puede superar su máximo por trabajo.');
  return value;
};
export const resolveAutomationPolicy = (
  global: AutomationBudgetConfig = DEFAULT_AUTOMATION_BUDGET, client: ClientAutomationConfig = {}, request: Partial<CreateAutomationJobRequest> = {},
): AutomationPolicy => {
  validateAutomationBudget(global);
  if (client.enabled === false) throw new Error('Automatización desactivada para el cliente.');
  const budgetUsd = request.budgetUsd ?? client.defaultBudgetUsd ?? global.defaultBudgetUsd;
  const maxReviewAttempts = request.maxReviewAttempts ?? client.maxReviewAttempts ?? global.maxReviewAttempts;
  const maxOperationalRetries = request.maxOperationalRetries ?? client.maxOperationalRetries ?? global.maxOperationalRetries;
  const maxBudgetUsd = effectiveMaxBudgetUsd(global, client);
  if (!positive(budgetUsd) || budgetUsd > maxBudgetUsd) throw new Error(positive(client.maxBudgetUsd)
    ? 'El presupuesto supera el máximo del cliente o no es válido.' : 'El presupuesto supera el máximo global o no es válido.');
  if (!Number.isInteger(maxReviewAttempts) || maxReviewAttempts < 1 || maxReviewAttempts > Math.min(global.maxReviewAttempts, client.maxReviewAttempts ?? global.maxReviewAttempts)) throw new Error('Intentos de calidad fuera del límite autorizado.');
  if (!Number.isInteger(maxOperationalRetries) || maxOperationalRetries < 0 || maxOperationalRetries > Math.min(global.maxOperationalRetries, client.maxOperationalRetries ?? global.maxOperationalRetries)) throw new Error('Reintentos operativos fuera del límite autorizado.');
  return { budgetUsd, maxReviewAttempts, maxOperationalRetries,
    allowEstimatedCosts: request.allowEstimatedCosts === true, authorizeClassification: request.authorizeClassification === true };
};
export const usd = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
export const remainingAutomationBudget = (budget: { limitUsd: number; spentUsd: number; reservedUsd: number; pendingUsd?: number }): number =>
  Math.max(0, usd(budget.limitUsd - budget.spentUsd - budget.reservedUsd - Math.max(0, budget.pendingUsd || 0)));

/** Old ledgers retained surplus holds even for recorded results. Keep that exposure
 * visible without calling it unknown provider billing or releasing historical money. */
export const automationBudgetBreakdown = (budget: AutomationBudgetState) => ({
  recordedUsd: budget.recordedUsd,
  reservedUsd: usd(Math.max(0, budget.reservedUsd) + Math.max(0, budget.pendingUsd || 0)),
  uncertainUsd: budget.uncertainUsd ?? 0,
  historicalRetainedUsd: Math.max(0, usd(budget.spentUsd - budget.recordedUsd - (budget.uncertainUsd ?? 0))),
});
