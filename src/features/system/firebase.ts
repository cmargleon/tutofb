import { httpsCallable } from 'firebase/functions';
import {
  SystemHealthSnapshot,
  UpdateSystemAlertSettingsRequest,
  UpdateSystemAlertSettingsResponse,
  UpdateSystemConfigRequest,
  UpdateSystemConfigResponse,
  GetSystemConfigResponse,
} from '../../../shared/src/types';
import { functions } from '../../firebase';
import { normalizeSystemHealthSnapshot } from './normalize';

export const getSystemHealth = async (): Promise<SystemHealthSnapshot> => {
  const callable = httpsCallable<Record<string, never>, SystemHealthSnapshot>(functions, 'getSystemHealth');
  const result = await callable({});
  return normalizeSystemHealthSnapshot(result.data);
};

export const updateSystemAlertSettings = async (
  payload: UpdateSystemAlertSettingsRequest,
): Promise<UpdateSystemAlertSettingsResponse> => {
  const callable = httpsCallable<UpdateSystemAlertSettingsRequest, UpdateSystemAlertSettingsResponse>(
    functions,
    'updateSystemAlertSettings',
  );
  const result = await callable(payload);
  return result.data;
};

export const getSystemConfigFromServer = async (): Promise<GetSystemConfigResponse> => {
  const callable = httpsCallable<Record<string, never>, GetSystemConfigResponse>(functions, 'getSystemConfig');
  const result = await callable({});
  return result.data;
};

export const updateSystemConfig = async (
  payload: UpdateSystemConfigRequest,
): Promise<UpdateSystemConfigResponse> => {
  const callable = httpsCallable<UpdateSystemConfigRequest, UpdateSystemConfigResponse>(
    functions,
    'updateSystemConfig',
  );
  const result = await callable(payload);
  return result.data;
};
