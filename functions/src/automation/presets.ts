import { AutomationPreset, Client, CreateAutomationJobRequest } from '../../../shared/src/types';
import { AutomationAttentionError } from './imports';
import { DEFAULT_AUTOMATION_PROVIDER } from './provider';

export const PRODUCT_IDENTITY_RULES = 'Preserve the exact referenced product: shape, geometry, proportions, colors, materials, logos, lettering, prints and every physical part. Do not redesign, add or remove pieces. References show the same product, not a person or pose. Photorealistic commercial product photography, no invented branding or text.';
export const PRODUCT_PRESETS = {
  generic_product: {
    mode: 'image-to-image', aspectRatio: '1:1', maxReviewAttempts: 3,
    scenes: [
      { type: 'clean', prompt: 'One product on a clean white seamless background, soft studio lighting, accurate contact shadow.' },
      { type: 'lifestyle_1', prompt: 'One product in a realistic appropriate everyday environment, natural daylight. Product remains clearly visible.' },
      { type: 'lifestyle_2', prompt: 'One product in a different realistic use-context, warm interior lighting. Do not invent functionality or attachments.' },
      { type: 'hero', prompt: 'One product as the hero of an elegant studio composition, neutral background, detailed materials and controlled lighting.' },
    ],
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
