import { modelPhotoBases, selectedPhotoMarketplaces } from '../../../shared/src/modelPhotoSets';
import { activePhotoChannels } from '../../../shared/src/marketplacePhotoPlan';
import { COMMERCIAL_PHOTO_PROFILE } from '../../../shared/src/commercialPhoto';
import { resolveAutomationPreset } from './presets';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { getManglarContext } from '../manglar/context';
import { delegatedStamp } from '../manglar/access';
import { createHash } from 'node:crypto';
import { DEFAULT_AUTOMATION_BUDGET, resolveAutomationPolicy } from '../../../shared/src/automationPolicy';
import { DEFAULT_AUTOMATION_RULES, resolveAutomationRules } from '../../../shared/src/automationConfig';
import { sanitizeSystemConfig } from '../admin/systemConfig';
import type { AutomationPlan, Client, Job } from '../../../shared/src/types';
import { jobMasterProductId, masterProductId } from '../spreadsheets/masterProducts';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { AutomationJob, AutomationJobReceipt, RetryAutomationJobRequest } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { authorizeMachineJob } from './machineAuth';
import { automationKeys, canReadAutomation, MAX_INTAKE_ATTEMPTS, ORGANIZER_MAX_INPUT_IMAGES, validateAutomationInput } from './domain';

// Upload ownership is claimed on first automated use, independently of the caller's multi-client access.
// Reuse the private idempotency namespace; bindings never expose Storage paths or credentials.
const readUploadBindings = async (tx: FirebaseFirestore.Transaction, data: import('../../../shared/src/types').CreateAutomationJobRequest) => {
  const refs = [...new Set((data.inputImages || []).flatMap((image) => image.storagePath ? [image.storagePath] : []))]
    .map((path) => getAppFirestore().collection('automationKeys').doc(createHash('sha256').update(`upload-client:${path}`).digest('hex')));
  if (!refs.length) return [];
  const snapshots = await tx.getAll(...refs);
  if (snapshots.some((snapshot) => snapshot.exists && snapshot.data()?.inputClientId !== data.clientId)) throw new HttpsError('permission-denied', 'Una fotografía subida ya está asociada a otro cliente. Sube una referencia propia de este cliente.');
  return snapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.ref);
};

/** Both legacy identities a generation can produce: per automation (scene jobs) and per article (photo-plan jobs). */
export const organizerLegacyIds = (clientId: string, automationJobId: string, itemId: string) => [
  masterProductId({ id: automationJobId, automationJobId }, itemId),
  jobMasterProductId({ id: automationJobId, automationJobId }, { clientId, garmentId: itemId, photoTask: { productId: itemId } as Job['photoTask'] }),
];

/** Commercial links, aliases and upload claims are written in parts of this size, outside the job transaction. */
export const ORGANIZER_WRITE_CHUNK = 200;
/** A new automation job leaves room in its 1 MiB document for the caches and items written during intake. */
export const MAX_NEW_AUTOMATION_DOCUMENT_BYTES = 700_000;
const chunks = <T>(items: T[], size = ORGANIZER_WRITE_CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/**
 * An Organizer automation is created in two steps so hundreds of articles never exceed a transaction:
 * 1. its deterministic id (derived from the idempotency key) receives every commercial link, legacy alias and
 *    upload claim in small idempotent parts (`set` of the same content; aliases and claims only when absent);
 * 2. one small transaction creates the job and its keys. The intake trigger only reacts to the job document,
 *    so it never sees a job without all of its links, and a retry after a crash repeats step 1 harmlessly.
 */
async function writeOrganizerLinks(data: import('../../../shared/src/types').CreateAutomationJobRequest, jobRef: FirebaseFirestore.DocumentReference,
  links: import('../organizer/commerce').OrganizerCommercialLink[]) {
  const db = getAppFirestore();
  const paths = [...new Set((data.inputImages || []).flatMap(image => image.storagePath ? [image.storagePath] : []))];
  for (const part of chunks(paths)) await db.runTransaction(async tx => {
    const refs = part.map(path => db.collection('automationKeys').doc(createHash('sha256').update(`upload-client:${path}`).digest('hex')));
    const snapshots = await tx.getAll(...refs);
    if (snapshots.some(snapshot => snapshot.exists && snapshot.data()?.inputClientId !== data.clientId)) throw new HttpsError('permission-denied', 'Una fotografía subida ya está asociada a otro cliente. Sube una referencia propia de este cliente.');
    snapshots.forEach(snapshot => { if (!snapshot.exists) tx.create(snapshot.ref, { inputClientId: data.clientId }); });
  });
  for (const part of chunks(links)) {
    const batch = db.batch();
    for (const link of part) batch.set(jobRef.collection('organizerCommerce').doc(link.itemId), link);
    await batch.commit();
  }
  // Route this generation's legacy master identities to the bound canonical product. Existing aliases
  // or materialized legacy products are never rewritten: those keep their explicit review path.
  const client = db.collection('clients').doc(data.clientId);
  const aliases = links.flatMap(link => link.catalogBinding ? organizerLegacyIds(data.clientId, jobRef.id, link.itemId)
    .map(id => ({ binding: link.catalogBinding!, ref: client.collection('productAliases').doc(id) })) : []);
  for (const part of chunks(aliases, ORGANIZER_WRITE_CHUNK / 2)) await db.runTransaction(async tx => {
    const state = await tx.getAll(...part.map(alias => alias.ref), ...part.map(alias => client.collection('products').doc(alias.ref.id)));
    part.forEach(({ ref: alias, binding }, index) => {
      if (!state[index].exists && !state[index + part.length].exists)
        tx.set(alias, { clientId: data.clientId, productId: binding.productId, legacyProductId: alias.id, origin: 'organizer', baseCode: binding.baseCode, automationJobId: jobRef.id });
    });
  });
}

export const createAutomation = async (input: unknown, uid: string, role: string, plan?: AutomationPlan,
  organizerInput?: import('../organizer/commerce').OrganizerCommercialLink | import('../organizer/commerce').OrganizerCommercialLink[]): Promise<AutomationJobReceipt> => {
  // One organizer update can carry many articles: each keeps its own commercial link under organizerCommerce/{itemId}.
  const organizerLinks = organizerInput === undefined ? [] : Array.isArray(organizerInput) ? organizerInput : [organizerInput];
  const organizer = organizerLinks[0];
  const data = validateAutomationInput(input, uid, organizer ? ORGANIZER_MAX_INPUT_IMAGES : undefined);
  if (role !== 'automation') await assertHumanClientAccess(uid, data.clientId);
  if (role === 'automation') await authorizeMachineJob(uid, data.clientId, data.jobType);
  const db = getAppFirestore();
  const keys = automationKeys(data).map(key => db.collection('automationKeys').doc(organizer ? `organizer-${key}` : key));
  // Organizer jobs use the key as id so their links can be written before the job exists (see writeOrganizerLinks).
  const ref = organizer ? db.collection('automationJobs').doc(keys[0].id) : db.collection('automationJobs').doc();
  if (organizer) {
    const [known, client, system] = await db.getAll(keys[0], db.collection('clients').doc(data.clientId), db.collection('system_config').doc('main'));
    if (!known.exists) {
      // Validate the policy first, so a request that cannot be created leaves no links behind.
      try { resolveAutomationPolicy(system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET, (client.data() as Client | undefined)?.automation, data); }
      catch (error) { throw new HttpsError('failed-precondition', (error as Error).message); }
      await writeOrganizerLinks(data, ref, organizerLinks);
    }
  }
  const receipt = await db.runTransaction(async (tx) => {
    const keyDocs = await tx.getAll(...keys);
    const jobIds = [...new Set(keyDocs.filter((doc) => doc.exists).map((doc) => doc.data()!.jobId as string))];
    if (jobIds.length > 1) throw new HttpsError('already-exists', 'Los identificadores corresponden a trabajos diferentes.');
    if (jobIds.length) {
      const existing = await tx.get(db.collection('automationJobs').doc(jobIds[0]));
      const job = existing.data() as AutomationJob | undefined;
      if (!job || !canReadAutomation(job, uid, role) || (job.clientId !== data.clientId || job.jobType !== data.jobType)) throw new HttpsError('permission-denied', 'Identificador no disponible.');
      if (organizer && !(await tx.get(existing.ref.collection('organizerCommerce').doc(organizer.itemId))).exists)
        throw new HttpsError('failed-precondition', 'La solicitud existente no tiene el vínculo comercial del Organizador.');
      if (plan) tx.update(db.collection('automationPlans').doc(plan.id), { executedJobId: existing.id });
      keys.forEach((key) => tx.set(key, { jobId: existing.id }));
      return { jobId: existing.id, status: job.status, duplicate: true };
    }
    const client = await tx.get(db.collection('clients').doc(data.clientId));
    if (!client.exists || client.data()?.status === 'archived') throw new HttpsError('failed-precondition', 'Cliente no disponible.');
    const system = await tx.get(db.collection('system_config').doc('main'));
    let policy;
    try { policy = resolveAutomationPolicy(system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET, (client.data() as Client).automation, plan ? { ...data, ...plan.policy } : data); }
    catch (error) { throw new HttpsError('failed-precondition', (error as Error).message); }
    const uploadBindings = organizer ? [] : await readUploadBindings(tx, data);
    const now = FieldValue.serverTimestamp();
    const resolved = plan ? null : resolveAutomationPreset(data, client.data() as Client);
    const photoModelId = data.jobType !== 'garment' ? null : plan ? plan.photoModelId || null : resolved?.modelId || null;
    const photoModel = !plan && photoModelId && activePhotoChannels((client.data() as Client).marketplaces).length
      ? (await tx.get(db.doc(`models/${photoModelId}`))).data() as import('../../../shared/src/types').Model | undefined : undefined;
    if (photoModel && (photoModel.clientId !== data.clientId || photoModel.active === false || photoModel.status === 'archived')) throw new HttpsError('failed-precondition', 'Modelo no disponible.');
    const photoBases = plan?.photoBases ?? modelPhotoBases(photoModel, resolved?.config.poseIds);
    let selectedMarketplaces: Client['marketplaces'];
    try { selectedMarketplaces = data.jobType === 'garment' && !plan ? selectedPhotoMarketplaces((client.data() as Client).marketplaces, data.selectedChannels ?? resolved?.config.selectedChannels) : undefined; }
    catch (error) { throw new HttpsError('failed-precondition', (error as Error).message); }
    const job: AutomationJob = {
      ...(organizer ? { organizerCommerce: true as const } : {}),
      ...(plan ? (plan.photoProfile ? { photoProfile: plan.photoProfile } : {}) : { photoProfile: COMMERCIAL_PHOTO_PROFILE, resolvedPreset: resolved!.config }),
      ...(getManglarContext()?.caller ? { manglarAuthorization: delegatedStamp(getManglarContext()!.caller!) } : {}),
      ...(data.jobType === 'garment' && (plan?.photoMarketplaces !== undefined || !plan) ? { photoBases, photoModelId } : {}),
      ...(data.jobType !== 'garment' ? {} : plan?.photoMarketplaces !== undefined ? { photoMarketplaces: plan.photoMarketplaces } : !plan ? { photoMarketplaces: selectedMarketplaces || {} } : {}),
      ...data, clientNameSnapshot: client.data()!.name, effectivePolicy: policy,
      effectiveRules: plan ? plan.effectiveRules ?? { ...DEFAULT_AUTOMATION_RULES }
        : resolveAutomationRules(sanitizeSystemConfig(system.data()).automationRules, (client.data() as Client).automation?.rules),
      budget: { limitUsd: policy.budgetUsd, reservedUsd: 0, spentUsd: 0, recordedUsd: 0, providerConfirmedUsd: null },
      ...(plan ? { planId: plan.id, resolvedPreset: plan.preset, estimatedCostUsd: plan.estimatedCostUsd, ...(plan.modelOptions ? { modelOptions: plan.modelOptions } : {}) } : {}), ...(role === 'automation' ? { automationPrincipalId: uid.slice('automation-'.length) } : {}), id: ref.id, requestedPreset: data.preset || resolved?.name || plan?.presetName || '', createdByUid: uid, status: 'pending',
      inputImages: data.inputImages || [], sourceImages: data.inputImages || [], outputImages: [], generationJobIds: [], batchId: null,
      createdAt: now, updatedAt: now, startedAt: null, completedAt: null, failedAt: null,
      error: null, retryCount: 0, leaseToken: null, leaseExpiresAt: null,
      progress: { total: 0, completed: 0, failed: 0 },
    };
    if (Buffer.byteLength(JSON.stringify(job)) > MAX_NEW_AUTOMATION_DOCUMENT_BYTES)
      throw new HttpsError('resource-exhausted', 'El trabajo de automatización no cabe en un documento. Divide los artículos en varios trabajos.');
    if (organizer) {
      // Every link was written before this transaction; the job only becomes visible once they all exist.
      const linked = await tx.getAll(...organizerLinks.map(link => ref.collection('organizerCommerce').doc(link.itemId)));
      if (linked.some(link => !link.exists)) throw new HttpsError('aborted', 'Faltan vínculos comerciales del Organizador; reintenta la creación.');
    }
    uploadBindings.forEach((binding) => tx.create(binding, { inputClientId: data.clientId }));
    tx.create(ref, job);
    if (plan) tx.update(db.collection('automationPlans').doc(plan.id), { executedJobId: ref.id });
    keys.forEach((key) => tx.create(key, { jobId: ref.id }));
    return { jobId: ref.id, status: 'pending' as const, duplicate: false };
  });
  logger.info(receipt.duplicate ? 'automation duplicate ignored' : 'automation job created', { jobId: receipt.jobId, source: data.source });
  return receipt;
};

export const retryAutomation = async (input: RetryAutomationJobRequest, uid: string, role: string): Promise<AutomationJobReceipt> => {
  if (!input || typeof input.jobId !== 'string' || !/^[\w-]{1,200}$/.test(input.jobId)) throw new HttpsError('invalid-argument', 'jobId inválido.');
  const db = getAppFirestore();
  const ref = db.collection('automationJobs').doc(input.jobId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Trabajo no encontrado.');
    const job = snap.data() as AutomationJob;
    if (role !== 'automation') await assertHumanClientAccess(uid, job.clientId);
    if (!canReadAutomation(job, uid, role)) throw new HttpsError('permission-denied', 'Sin acceso.');
    if (job.batchId) throw new HttpsError('failed-precondition', 'Usa los controles de reintento del batch existente.');
    if (job.organizerCommerce && input.inputImages) throw new HttpsError('failed-precondition', 'Para cambiar las referencias, inicia una nueva selección en el Organizador.');
    const system = await tx.get(db.collection('system_config').doc('main'));
    const client = await tx.get(db.collection('clients').doc(job.clientId));
    const global = system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET;
    const maxIntakeRetries = Math.min(job.effectivePolicy?.maxOperationalRetries ?? MAX_INTAKE_ATTEMPTS - 1, global.maxOperationalRetries, client.data()?.automation?.maxOperationalRetries ?? global.maxOperationalRetries);
    if (!['failed', 'needs_attention'].includes(job.status) || job.retryCount >= maxIntakeRetries) throw new HttpsError('failed-precondition', 'Reintentos agotados o trabajo activo.');
    const data = validateAutomationInput({ ...job, inputImages: job.sourceImages || job.inputImages, ...input }, input.inputImages ? uid : job.createdByUid);
    if (job.planId && (input.preset || input.provider || input.modelId)) throw new HttpsError('failed-precondition', 'Prepara un nuevo plan para cambiar la configuración autorizada.');
    const updatedPreset = job.photoProfile && (input.preset || input.provider || input.modelId) ? resolveAutomationPreset(data, client.data() as Client).config : null;
    const uploadBindings = await readUploadBindings(tx, data);
    uploadBindings.forEach((binding) => tx.create(binding, { inputClientId: data.clientId }));
    tx.update(ref, {
      ...(getManglarContext()?.caller ? { manglarAuthorization: delegatedStamp(getManglarContext()!.caller!) } : {}),
      ...((input.preset || input.provider || input.modelId) ? { resolvedPreset: updatedPreset || FieldValue.delete(), modelOptions: FieldValue.delete() } : {}),
      ...(data.provider ? { provider: data.provider } : {}),
      modelId: data.modelId || null, requestedPreset: data.preset || '', preset: data.preset || null,
      inputImages: data.inputImages || [], ...(input.inputImages ? { sourceImages: input.inputImages } : {}), status: 'pending', error: null,
      retryCount: job.retryCount + 1, leaseToken: null, leaseExpiresAt: null,
      failedAt: null, updatedAt: FieldValue.serverTimestamp(),
    });
    return { jobId: ref.id, status: 'pending' as const };
  });
  logger.info('automation retry', { jobId: ref.id });
  return result;
};
export const automationPublicError = (error: unknown): AutomationJob['error'] => error instanceof HttpsError
  ? { code: error.code, message: error.message }
  : { code: 'processing-failed', message: 'No se pudo procesar el trabajo. Revisa la configuración o reintenta desde Manglar.' };
