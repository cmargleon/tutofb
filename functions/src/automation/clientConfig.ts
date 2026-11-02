import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { ClientAutomationConfig, Model, UpdateClientAutomationRequest } from '../../../shared/src/types';
import { resolveAutomationPolicy, DEFAULT_AUTOMATION_BUDGET } from '../../../shared/src/automationPolicy';
import { isProvider } from '../../../shared/src/domain';
import { isProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { PRODUCT_SCENES } from '../../../shared/src/productGeneration';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { parseDriveFolderId, validateDriveFolder } from './drive';

export const saveClientAutomation = async (input: UpdateClientAutomationRequest, db: Firestore = getAppFirestore()): Promise<ClientAutomationConfig> => {
  if (!input || typeof input.clientId !== 'string' || !/^[\w-]{1,200}$/.test(input.clientId) || !input.automation || typeof input.automation !== 'object') throw new HttpsError('invalid-argument', 'Configuración de cliente inválida.');
  const ref = db.collection('clients').doc(input.clientId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
  const raw = input.automation;
  if (typeof raw.enabled !== 'boolean') throw new HttpsError('invalid-argument', 'Activación inválida.');
  if (raw.driveFolderIds !== undefined && (!Array.isArray(raw.driveFolderIds) || raw.driveFolderIds.length > 20 || raw.driveFolderIds.some((id) => typeof id !== 'string'))) throw new HttpsError('invalid-argument', 'Máximo 20 carpetas de Drive.');
  const config: ClientAutomationConfig = { enabled: raw.enabled, driveFolderIds: [...new Set((raw.driveFolderIds || []).map(parseDriveFolderId))] };
  for (const key of ['defaultModelId', 'defaultPreset'] as const) {
    if (raw[key]) { if (typeof raw[key] !== 'string' || !/^[\w-]{1,200}$/.test(raw[key])) throw new HttpsError('invalid-argument', `${key} inválido.`); config[key] = raw[key]; }
  }
  for (const key of ['defaultBudgetUsd', 'maxReviewAttempts', 'maxOperationalRetries'] as const) if (raw[key] !== undefined) config[key] = raw[key];
  config.presets = raw.presets || {};
  if (Array.isArray(config.presets) || Object.keys(config.presets).length > 20 || JSON.stringify(config.presets).length > 100000) throw new HttpsError('invalid-argument', 'Presets inválidos.');
  for (const [name, preset] of Object.entries(config.presets)) {
    if (!/^[\w-]{1,80}$/.test(name) || !preset || typeof preset !== 'object' || Object.keys(preset).some((key) => !['modelId', 'poseIds', 'provider', 'aspectRatio', 'imageConfig', 'prompt', 'scenes'].includes(key))
      || (preset.provider !== undefined && !isProvider(preset.provider))
      || (preset.imageConfig !== undefined && (!isProviderImageConfig(preset.imageConfig) || preset.imageConfig.provider !== preset.provider))
      || (preset.prompt !== undefined && (typeof preset.prompt !== 'string' || preset.prompt.length > 30000))
      || (preset.aspectRatio !== undefined && !['1:1','3:4','4:3','2:3','3:2','9:16','16:9'].includes(preset.aspectRatio))
      || (preset.poseIds !== undefined && (!Array.isArray(preset.poseIds) || !preset.poseIds.length || preset.poseIds.some((id) => typeof id !== 'string')))
      || (preset.scenes !== undefined && (!Array.isArray(preset.scenes) || !preset.scenes.length || preset.scenes.length > 6 || new Set(preset.scenes.map((s) => s.type)).size !== preset.scenes.length || preset.scenes.some((s) => !PRODUCT_SCENES.some((p) => p.type === s.type) || typeof s.prompt !== 'string' || !s.prompt.trim() || s.prompt.length > 4000)))) throw new HttpsError('invalid-argument', `Preset ${name} inválido.`);
    const modelId = preset.modelId || config.defaultModelId;
    if (modelId) {
      const model = (await db.collection('models').doc(modelId).get()).data() as Model | undefined;
      if (!model || model.clientId !== input.clientId || model.status === 'archived' || preset.poseIds?.some((id) => !model.poses.some((p) => p.id === id))) throw new HttpsError('invalid-argument', 'Modelo o poses ajenos al cliente.');
    } else if (preset.poseIds) throw new HttpsError('invalid-argument', 'Las poses requieren un modelo del cliente.');
  }
  if (config.defaultModelId) {
    const model = (await db.collection('models').doc(config.defaultModelId).get()).data();
    if (!model || model.clientId !== input.clientId || model.status === 'archived') throw new HttpsError('invalid-argument', 'Modelo predeterminado ajeno al cliente.');
  }
  for (const id of config.driveFolderIds!) await validateDriveFolder(id);
  // Re-read global limits in the transaction; concurrent System edits cannot be bypassed.
  await db.runTransaction(async (tx) => {
    const system = await tx.get(db.collection('system_config').doc('main'));
    const global = system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET;
    try { resolveAutomationPolicy(global, { ...config, enabled: true }); }
    catch (error) { throw new HttpsError('invalid-argument', (error as Error).message); }
    tx.update(ref, { automation: config, updatedAt: FieldValue.serverTimestamp() });
  });
  return config;
};
export const updateClientAutomation = onCall<UpdateClientAutomationRequest>(async (request) => {
  await assertCallableRoles(request, ['admin']);
  return { automation: await saveClientAutomation(request.data) };
});
