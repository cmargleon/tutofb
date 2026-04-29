import { httpsCallable } from 'firebase/functions';
import {
  FinanceDashboardData,
  CreateFinanceManualEventRequest,
  CreateFinanceManualEventResponse,
  GetFinanceDashboardRequest,
  RebuildFinanceSnapshotsRequest,
  RebuildFinanceSnapshotsResponse,
  UpdateFinanceSettingsRequest,
  UpdateFinanceSettingsResponse,
  UpsertFinanceClientPricingRequest,
  UpsertFinanceClientPricingResponse,
} from '../../../shared/src/types';
import { functions } from '../../firebase';

export const getFinanceDashboard = async (payload: GetFinanceDashboardRequest): Promise<FinanceDashboardData> => {
  const callable = httpsCallable<GetFinanceDashboardRequest, FinanceDashboardData>(functions, 'getFinanceDashboard');
  const result = await callable(payload);
  return result.data;
};

export const updateFinanceSettings = async (
  payload: UpdateFinanceSettingsRequest,
): Promise<UpdateFinanceSettingsResponse> => {
  const callable = httpsCallable<UpdateFinanceSettingsRequest, UpdateFinanceSettingsResponse>(functions, 'updateFinanceSettings');
  const result = await callable(payload);
  return result.data;
};

export const upsertFinanceClientPricing = async (
  payload: UpsertFinanceClientPricingRequest,
): Promise<UpsertFinanceClientPricingResponse> => {
  const callable = httpsCallable<UpsertFinanceClientPricingRequest, UpsertFinanceClientPricingResponse>(functions, 'upsertFinanceClientPricing');
  const result = await callable(payload);
  return result.data;
};

export const rebuildFinanceSnapshots = async (
  payload: RebuildFinanceSnapshotsRequest,
): Promise<RebuildFinanceSnapshotsResponse> => {
  const callable = httpsCallable<RebuildFinanceSnapshotsRequest, RebuildFinanceSnapshotsResponse>(
    functions,
    'rebuildFinanceSnapshots',
    { timeout: 540000 },
  );
  const result = await callable(payload);
  return result.data;
};

export const createFinanceManualEvent = async (
  payload: CreateFinanceManualEventRequest,
): Promise<CreateFinanceManualEventResponse> => {
  const callable = httpsCallable<CreateFinanceManualEventRequest, CreateFinanceManualEventResponse>(
    functions,
    'createFinanceManualEvent',
  );
  const result = await callable(payload);
  return result.data;
};
