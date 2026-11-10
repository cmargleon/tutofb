import { COMMERCIAL_PHOTO_PROFILE, resolveCommercialPhotoConfig } from '../../../shared/src/commercialPhoto';
import { AutomationPreset, Client, CreateAutomationJobRequest, Model } from '../../../shared/src/types';
import { isPoseActive } from '../../../shared/src/domain';
import { AutomationAttentionError } from './imports';
import { DEFAULT_AUTOMATION_PROVIDER } from './provider';
import { resolveAutomationPresetName } from '../../../shared/src/automationConfig';

export { PRODUCT_IDENTITY_RULES } from '../../../shared/src/productGeneration';
import { PRODUCT_SCENES } from '../../../shared/src/productGeneration';
export const PRODUCT_PRESETS = {
  generic_product: {
    mode: 'image-to-image', aspectRatio: '3:4', maxReviewAttempts: 3,
    scenes: PRODUCT_SCENES,
    qualityRules: ['identity', 'colors', 'logos', 'parts', 'geometry', 'artifacts'],
  },
} as const;

export const resolveAutomationPoseIds = (model: Pick<Model, 'poses'>, requestedPoseIds?: string[]): string[] => {
  const poseMap = new Map(model.poses.map((pose) => [pose.id, pose]));
  if (requestedPoseIds?.some((id) => !poseMap.has(id))) {
    throw new AutomationAttentionError('Hay poses no disponibles en el modelo/preset.');
  }
  const poseIds = [...new Set(requestedPoseIds ?? model.poses.map((pose) => pose.id))]
    .filter((id) => isPoseActive(poseMap.get(id)!));
  if (!poseIds.length) {
    throw new AutomationAttentionError('No hay poses activas en el modelo/preset. Activa alguna pose o cambia el preset.');
  }
  return poseIds;
};

export const resolveAutomationPreset = (data: CreateAutomationJobRequest, client: Client): { name: string; config: AutomationPreset; modelId: string | null } => {
  const name = resolveAutomationPresetName(data, client.automation);
  const configured = client.automation?.presets?.[name];
  if (data.jobType === 'product' && name !== 'generic_product' && !configured) throw new AutomationAttentionError('Preset de producto no disponible. Revisa el preset en Cliente → Automatizaciones.');
  if (data.jobType === 'garment' && name !== 'standard' && !configured) throw new AutomationAttentionError('Preset del cliente no configurado. Revisa el preset en Cliente → Automatizaciones.');
  const provider = data.provider || configured?.provider || DEFAULT_AUTOMATION_PROVIDER;
  const config: AutomationPreset = { ...configured, provider, photoProfile: COMMERCIAL_PHOTO_PROFILE,
    ...resolveCommercialPhotoConfig(provider, undefined, configured?.aspectRatio, configured?.imageConfig) };
  const modelId = data.modelId || config.modelId || client.automation?.defaultModelId || null;
  return { name, config, modelId };
};
