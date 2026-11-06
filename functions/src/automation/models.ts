import { createHash } from 'node:crypto';
import type { AutomationModelOption, Client, GarmentGender, Model } from '../../../shared/src/types';
import { getClientGenderModelDefaults, getModelGender } from '../../../shared/src/automationModels';
import { getAppFirestore } from '../firebase/appFirestore';
import { AutomationAttentionError } from './imports';
import { resolveAutomationPoseIds } from './presets';

export function resolveAutomationModelOptions(clientId: string, client: Client, models: Model[], modelId?: string | null, poseIds?: string[]): AutomationModelOption[] {
  const defaults = getClientGenderModelDefaults(clientId, client.automation, models);
  const choices: Array<{ gender: AutomationModelOption['gender']; modelId: string }> = modelId
    ? [{ gender: null, modelId }]
    : [
      ...(defaults.defaultMaleModelId ? [{ gender: 'male' as const, modelId: defaults.defaultMaleModelId }] : []),
      ...(defaults.defaultFemaleModelId ? [{ gender: 'female' as const, modelId: defaults.defaultFemaleModelId }] : []),
    ];
  if (!choices.length && client.automation?.defaultModelId) choices.push({ gender: null, modelId: client.automation.defaultModelId });
  if (!choices.length) throw new AutomationAttentionError('Configura un modelo masculino o femenino predeterminado en Clientes, o selecciona un modelo para este pedido.');
  const options = choices.flatMap(choice => {
    const model = models.find(model => model.id === choice.modelId);
    if (!model || model.clientId !== clientId || model.active === false || model.status === 'archived') {
      if (choice.gender) return [];
      throw new AutomationAttentionError('Un modelo predeterminado no está disponible para este cliente. Revisa su configuración en Clientes.');
    }
    const gender = getModelGender(model);
    if (choice.gender && gender && choice.gender !== gender) throw new AutomationAttentionError('El género de un modelo predeterminado no coincide con su configuración en Clientes.');
    return [{ ...choice, poseIds: resolveAutomationPoseIds(model, poseIds) }];
  });
  if (!options.length) throw new AutomationAttentionError('No hay modelos predeterminados disponibles. Revisa la configuración en Clientes.');
  return options;
}

export async function loadAutomationModelOptions(clientId: string, client: Client, modelId?: string | null, poseIds?: string[]) {
  const snapshot = await getAppFirestore().collection('models').where('clientId', '==', clientId).get();
  return resolveAutomationModelOptions(clientId, client, snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Model)), modelId, poseIds);
}

export function selectAutomationModel(options: AutomationModelOption[], gender: GarmentGender | null | undefined, confidence: number | null | undefined, stableKey: string): AutomationModelOption | null {
  if (!options.length) return null;
  if (new Set(options.map(option => option.modelId)).size === 1) return options[0];
  if (!gender || (confidence ?? 0) < 0.65) return null;
  if (gender !== 'unisex') return options.find(option => option.gender === gender) || null;
  const sorted = [...options].sort((a, b) => a.modelId.localeCompare(b.modelId));
  return sorted[createHash('sha256').update(stableKey).digest().readUInt32BE(0) % sorted.length];
}
