import type { TimestampLike, Provider } from './common';

export type FinanceCurrency = 'MXN' | 'USD';
export type FinanceEventType = 'cost' | 'revenue' | 'adjustment';
export type FinanceEventCategory =
  | 'provider_generation'
  | 'gemini_usage'
  | 'model_generation'
  | 'human_operation'
  | 'fixed_cost_allocation'
  | 'estimated_revenue'
  | 'invoiced_revenue'
  | 'manual_adjustment';
export type FinanceBillingMode = 'approved_outputs' | 'generated_outputs' | 'batch' | 'retainer_plus_usage';
export type FinanceFixedCostAllocationMethod = 'by_completed_outputs' | 'by_generated_outputs' | 'by_revenue' | 'manual_weight';
export type FinanceFxRateSource = 'manual' | 'system_default' | 'backfill';

export interface FinanceMoneySnapshot {
  amount: number;
  currency: FinanceCurrency;
  amountMxn: number;
  amountUsd: number;
  fxRateUsdMxn: number;
  fxRateSource: FinanceFxRateSource;
  fxRateDate: string;
}

export interface FinanceSettings {
  reportingCurrency: FinanceCurrency;
  secondaryCurrency: FinanceCurrency;
  defaultFxRateUsdMxn: number;
  humanCostPerInterventionMxn: number;
  humanHourlyRatesMxn: Partial<Record<'admin' | 'operador' | 'revisor', number>>;
  updatedAt?: TimestampLike | null;
  updatedByUid?: string | null;
  updatedByDisplayName?: string | null;
}

export interface FinanceFxRate {
  date: string;
  usdMxn: number;
  source: FinanceFxRateSource;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  updatedByUid?: string | null;
}

export interface FinanceClientPricing {
  id?: string;
  clientId: string;
  clientNameSnapshot: string;
  billingMode: FinanceBillingMode;
  currency: FinanceCurrency;
  pricePerApprovedOutput: number;
  pricePerGeneratedOutput: number;
  pricePerBatch: number;
  monthlyRetainer: number;
  minimumMonthly: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
  notes?: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  updatedByUid?: string | null;
  updatedByDisplayName?: string | null;
}

export interface FinanceFixedCost {
  id?: string;
  period: string;
  name: string;
  amount: number;
  currency: FinanceCurrency;
  allocationMethod: FinanceFixedCostAllocationMethod;
  clientId?: string | null;
  notes?: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  updatedByUid?: string | null;
}

export interface FinanceEvent {
  id?: string;
  type: FinanceEventType;
  category: FinanceEventCategory;
  description: string;
  period: string;
  money: FinanceMoneySnapshot;
  clientId?: string | null;
  clientNameSnapshot?: string | null;
  batchId?: string | null;
  jobId?: string | null;
  modelId?: string | null;
  modelNameSnapshot?: string | null;
  provider?: Provider | 'gemini' | string | null;
  userUid?: string | null;
  flow?: string | null;
  quantity?: number | null;
  sourceCollection: string;
  sourceId: string;
  pricingSnapshot?: Partial<FinanceClientPricing> | null;
  costSnapshot?: Record<string, unknown> | null;
  createdAt: TimestampLike;
  sourceCreatedAt?: TimestampLike | null;
}

export interface FinanceSnapshotBase {
  id?: string;
  period?: string;
  revenueMxn: number;
  revenueUsd: number;
  variableCostMxn: number;
  variableCostUsd: number;
  humanCostMxn: number;
  humanCostUsd: number;
  allocatedFixedCostMxn: number;
  allocatedFixedCostUsd: number;
  grossProfitMxn: number;
  grossProfitUsd: number;
  eventCount: number;
  updatedAt: TimestampLike;
}

export interface FinanceClientSnapshot extends FinanceSnapshotBase {
  clientId: string;
  clientNameSnapshot: string;
}

export interface FinanceBatchSnapshot extends FinanceSnapshotBase {
  batchId: string;
  clientId: string;
  clientNameSnapshot: string;
  modelId?: string | null;
  modelNameSnapshot?: string | null;
  totalJobs?: number;
  completedJobs?: number;
  completedOutputCount?: number;
}

export interface FinanceJobSnapshot extends FinanceSnapshotBase {
  jobId: string;
  batchId: string;
  clientId: string;
  clientNameSnapshot: string;
  modelId?: string | null;
  modelNameSnapshot?: string | null;
  provider?: Provider | string | null;
}

export interface FinanceProviderSnapshot extends FinanceSnapshotBase {
  provider: Provider | 'gemini' | string;
}

export interface FinanceModelSnapshot extends FinanceSnapshotBase {
  modelId: string;
  modelNameSnapshot: string;
  clientId?: string | null;
  clientNameSnapshot?: string | null;
}

export interface FinanceSummarySnapshot extends FinanceSnapshotBase {
  reportingCurrency: FinanceCurrency;
  secondaryCurrency: FinanceCurrency;
}

export interface FinanceDashboardData {
  settings: FinanceSettings;
  summary: FinanceSummarySnapshot | null;
  clients: FinanceClientSnapshot[];
  batches: FinanceBatchSnapshot[];
  providers: FinanceProviderSnapshot[];
  models: FinanceModelSnapshot[];
  recentEvents: FinanceEvent[];
  pricing: FinanceClientPricing[];
}

export interface GetFinanceDashboardRequest {
  period?: string | null;
  clientId?: string | null;
}

export interface UpdateFinanceSettingsRequest extends Partial<Omit<FinanceSettings, 'updatedAt' | 'updatedByUid' | 'updatedByDisplayName'>> {}
export interface UpdateFinanceSettingsResponse { success: boolean; settings: FinanceSettings }

export interface UpsertFinanceClientPricingRequest {
  clientId: string;
  billingMode: FinanceBillingMode;
  currency: FinanceCurrency;
  pricePerApprovedOutput?: number;
  pricePerGeneratedOutput?: number;
  pricePerBatch?: number;
  monthlyRetainer?: number;
  minimumMonthly?: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  active?: boolean;
  notes?: string | null;
}
export interface UpsertFinanceClientPricingResponse { success: boolean; pricing: FinanceClientPricing }

export interface RebuildFinanceSnapshotsRequest {
  period?: string | null;
  includeExistingEvents?: boolean;
}
export interface RebuildFinanceSnapshotsResponse {
  success: boolean;
  period: string;
  eventsCreated: number;
  skippedEvents: number;
}

export interface CreateFinanceManualEventRequest {
  type: FinanceEventType;
  category: FinanceEventCategory;
  description: string;
  amount: number;
  currency: FinanceCurrency;
  period?: string | null;
  clientId?: string | null;
  batchId?: string | null;
  jobId?: string | null;
  modelId?: string | null;
  provider?: string | null;
  flow?: string | null;
}

export interface CreateFinanceManualEventResponse {
  success: boolean;
  eventId: string;
  created: boolean;
}
