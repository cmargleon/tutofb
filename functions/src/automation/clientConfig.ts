import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { ClientAutomationConfig, Model, UpdateClientAutomationRequest } from '../../../shared/src/types';
import { resolveAutomationPolicy, DEFAULT_AUTOMATION_BUDGET } from '../../../shared/src/automationPolicy';
import { isProvider } from '../../../shared/src/domain';
import { isProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { PRODUCT_SCENES } from '../../../shared/src/productGeneration';
import { getClientGenderModelDefaults, getModelGender } from '../../../shared/src/automationModels';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { parseDriveFolderId, validateDriveFolder } from './drive';
import { configSnapshot } from '../../../shared/src/configSnapshot';
import { selectClientAutomationSection } from '../../../shared/src/clientAutomationSections';
import { validateAutomationRules } from '../../../shared/src/automationConfig';

export const saveClientAutomation = async (input: UpdateClientAutomationRequest, db: Firestore = getAppFirestore()): Promise<ClientAutomationConfig> => {
  if (!input || typeof input.clientId !== 'string' || !/^[\w-]{1,200}$/.test(input.clientId) || !input.automation || typeof input.automation !== 'object') throw new HttpsError('invalid-argument', 'Configuración de cliente inválida.');
  if (input.section !== undefined && !['sources', 'automation'].includes(input.section)) throw new HttpsError('invalid-argument', 'Sección inválida.');
  if (input.section === 'sources' && (input.automation.driveFolderIds === undefined || Object.keys(input.automation).some(key => key !== 'driveFolderIds'))) throw new HttpsError('invalid-argument', 'Fuentes solo permite modificar carpetas de Drive.');
  if (input.section === 'automation' && input.automation.driveFolderIds !== undefined) throw new HttpsError('invalid-argument', 'Guarda las carpetas desde Fuentes de datos.');
  const ref = db.collection('clients').doc(input.clientId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
  const raw = input.automation;
  if (raw.driveFolderIds !== undefined && (!Array.isArray(raw.driveFolderIds) || raw.driveFolderIds.length > 20 || raw.driveFolderIds.some((id) => typeof id !== 'string'))) throw new HttpsError('invalid-argument', 'Máximo 20 carpetas de Drive.');
  let config: ClientAutomationConfig = {};
  const requestedFolders = raw.driveFolderIds && [...new Set(raw.driveFolderIds.map(parseDriveFolderId))];
  if (input.section !== 'sources') {
    if (typeof raw.enabled !== 'boolean') throw new HttpsError('invalid-argument', 'Activación inválida.');
    config.enabled = raw.enabled;
    if (raw.rules !== undefined) {
      try {
        const rules = validateAutomationRules(raw.rules);
        if (Object.keys(rules).length) config.rules = rules;
      } catch (error) { throw new HttpsError('invalid-argument', (error as Error).message); }
    }
    for (const key of ['defaultModelId', 'defaultMaleModelId', 'defaultFemaleModelId', 'defaultPreset'] as const) {
      if (raw[key] !== undefined && raw[key] !== '') { if (typeof raw[key] !== 'string' || !/^[\w-]{1,200}$/.test(raw[key])) throw new HttpsError('invalid-argument', `${key} inválido.`); config[key] = raw[key]; }
    }
    const models = (await db.collection('models').where('clientId', '==', input.clientId).get()).docs
      .map(doc => ({ ...doc.data(), id: doc.id } as Model));
    Object.assign(config, getClientGenderModelDefaults(input.clientId, config, models));
    for (const [gender, key] of [['male', 'defaultMaleModelId'], ['female', 'defaultFemaleModelId']] as const) {
      if (!config[key]) continue;
      const model = models.find(model => model.id === config[key]);
      if (!model || model.status === 'archived' || model.active === false || (getModelGender(model) && getModelGender(model) !== gender)) {
        throw new HttpsError('invalid-argument', `El modelo predeterminado ${gender === 'male' ? 'masculino' : 'femenino'} debe estar activo, pertenecer al cliente y corresponder al género elegido.`);
      }
    }
    if (config.defaultMaleModelId && config.defaultMaleModelId === config.defaultFemaleModelId) throw new HttpsError('invalid-argument', 'Selecciona modelos distintos para masculino y femenino.');
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
        if (!model || model.clientId !== input.clientId || model.status === 'archived' || model.active === false || preset.poseIds?.some((id) => !model.poses.some((p) => p.id === id))) throw new HttpsError('invalid-argument', 'Modelo o poses ajenos al cliente.');
      } else if (preset.poseIds) throw new HttpsError('invalid-argument', 'Las poses requieren un modelo del cliente.');
    }
    if (raw.organizerGeneration !== undefined) {
      const value = raw.organizerGeneration;
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['enabled', 'preset'].includes(key))
        || (value.enabled !== undefined && typeof value.enabled !== 'boolean')
        || (value.preset !== undefined && (typeof value.preset !== 'string'
          || (!['standard', 'generic_product'].includes(value.preset) && !Object.hasOwn(config.presets, value.preset))))) {
        throw new HttpsError('invalid-argument', 'Generación desde el Organizador inválida: revisa la activación y el preset en Cliente → Automatizaciones.');
      }
      const organizerGeneration = {
        ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
        ...(value.preset !== undefined ? { preset: value.preset } : {}),
      };
      if (Object.keys(organizerGeneration).length) config.organizerGeneration = organizerGeneration;
    }
    if (config.defaultModelId) {
      const model = (await db.collection('models').doc(config.defaultModelId).get()).data() as Model | undefined;
      if (!model || model.clientId !== input.clientId || model.status === 'archived' || model.active === false) throw new HttpsError('invalid-argument', 'Modelo predeterminado ajeno al cliente.');
    }
  }
  if (requestedFolders) {
    for (const id of requestedFolders) await validateDriveFolder(id);
  }
  // Re-read global limits in the transaction; concurrent System edits cannot be bypassed.
  await db.runTransaction(async (tx) => {
    const [system, current, organizer] = await tx.getAll(
      db.collection('system_config').doc('main'), ref, db.collection('organizers').doc(input.clientId),
    );
    if (!current.exists || current.data()?.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
    const comparable = (value: ClientAutomationConfig | null) => input.section ? selectClientAutomationSection(value, input.section) : value;
    if (input.expectedAutomation !== undefined && configSnapshot(comparable(input.expectedAutomation)) !== configSnapshot(comparable(current.data()?.automation ?? null))) {
      throw new HttpsError('aborted', 'La configuración cambió en otra sesión. Conservamos tu borrador; revisa los cambios actuales antes de volver a guardar.');
    }
    const previousFolders: string[] = current.data()?.automation?.driveFolderIds ?? [];
    const nextFolders = requestedFolders ?? previousFolders;
    const organizerSources: string[] = organizer.data()?.sourceIds ?? [];
    if (previousFolders.some(id => !nextFolders.includes(id) && organizerSources.includes(id))) {
      throw new HttpsError('failed-precondition', 'Quita primero la carpeta de los orígenes del Organizador inteligente.');
    }
    const added = nextFolders.filter(id => !previousFolders.includes(id));
    if (added.length) {
      const [clients, organizers] = await Promise.all([
        tx.get(db.collection('clients').where('automation.driveFolderIds', 'array-contains-any', added)),
        tx.get(db.collection('organizers').where('sourceIds', 'array-contains-any', added)),
      ]);
      if ([...clients.docs, ...organizers.docs].some(doc => doc.id !== input.clientId)) {
        throw new HttpsError('already-exists', 'Una de las carpetas ya está asignada a otro cliente.');
      }
    }
    if (input.section === 'sources') {
      config = { ...current.data()?.automation, driveFolderIds: nextFolders };
      tx.update(ref, { 'automation.driveFolderIds': nextFolders, updatedAt: FieldValue.serverTimestamp() });
      return;
    }
    const global = system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET;
    try { resolveAutomationPolicy(global, { ...config, enabled: true }); }
    catch (error) { throw new HttpsError('invalid-argument', (error as Error).message); }
    config.driveFolderIds = nextFolders;
    tx.update(ref, { automation: config, updatedAt: FieldValue.serverTimestamp() });
  });
  return config;
};
export const updateClientAutomation = onCall<UpdateClientAutomationRequest>(async (request) => {
  await assertCallableRoles(request, ['admin']);
  return { automation: await saveClientAutomation(request.data) };
});
