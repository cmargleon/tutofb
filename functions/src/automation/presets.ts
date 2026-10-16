import { AutomationPreset, Client, CreateAutomationJobRequest } from '../../../shared/src/types';
import { AutomationAttentionError } from './imports';
import { DEFAULT_AUTOMATION_PROVIDER } from './provider';

export { PRODUCT_IDENTITY_RULES } from '../../../shared/src/productGeneration';
import { PRODUCT_SCENES } from '../../../shared/src/productGeneration';
export const PRODUCT_PRESETS = {
  generic_product: {
    mode: 'image-to-image', aspectRatio: '1:1', maxReviewAttempts: 3,
    scenes: PRODUCT_SCENES,
    qualityRules: ['identity', 'colors', 'logos', 'parts', 'geometry', 'artifacts'],
  },
} as const;
export const resolveAutomationPreset = (data: CreateAutomationJobRequest, client: Client): { name: string; config: AutomationPreset; modelId: string | null } => {
  const name = data.preset || client.automation?.defaultPreset || (data.jobType === 'product' ? 'generic_product' : 'standard');
  const configured = client.automation?.presets?.[name];
  if (data.jobType === 'product' && name !== 'generic_product') throw new AutomationAttentionError('Preset de producto no disponible.');
  if (data.jobType === 'garment' && name !== 'standard' && !configured) throw new AutomationAttentionError('Preset del cliente no configurado.');
  const config = { ...configured, provider: data.provider || configured?.provider || DEFAULT_AUTOMATION_PROVIDER };
  const modelId = data.modelId || config.modelId || client.automation?.defaultModelId || null;
  if (data.jobType === 'garment' && !modelId) throw new AutomationAttentionError('Selecciona modelId o configura un modelo default/preset del cliente.');
  return { name, config, modelId };
};
