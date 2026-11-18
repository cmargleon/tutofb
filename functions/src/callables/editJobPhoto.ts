import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { EditJobPhotoRequest, EditJobPhotoResponse, Job, JobOutput } from '../../../shared/src/types';
import { DEFAULT_IMAGE_PROVIDER, isProvider } from '../../../shared/src/domain';
import { resolveCommercialPhotoConfig } from '../../../shared/src/commercialPhoto';
import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { assertCallableRoles } from '../auth/roles';
import { assertProviderEnabledInSystemConfig, getSystemConfigCached } from '../admin/systemConfig';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';
import { validatePhotoEditInstructions } from '../workers/jobImageEdit';
import { buildRegenerationReviewSignalsPatch } from '../review/reviewSignals';

export const editJobPhoto = onCall<EditJobPhotoRequest, Promise<EditJobPhotoResponse>>(async request => {
  await assertCallableRoles(request, ['admin', 'operador']);
  const jobId = validId(request.data?.jobId);
  const sourceOutputId = validId(request.data?.sourceOutputId);
  let instructions: string;
  try { instructions = validatePhotoEditInstructions(request.data?.instructions); }
  catch (error) { throw new HttpsError('invalid-argument', (error as Error).message); }
  const config = await getSystemConfigCached();
  const requestedProvider = request.data?.provider;
  if (requestedProvider != null && !isProvider(requestedProvider)) {
    throw new HttpsError('invalid-argument', 'Modelo IA no válido para editar fotos.');
  }
  // Every provider accepts reference images; the edit sends only the source photo.
  const provider = requestedProvider ?? DEFAULT_IMAGE_PROVIDER;
  assertProviderEnabledInSystemConfig(provider, config, 'editar fotos');
  const db = getAppFirestore();
  const jobRef = db.collection('jobs').doc(jobId);
  const uid = request.auth!.uid;
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async tx => {
    const [snapshot, sourceSnapshot, userSnapshot] = await tx.getAll(
      jobRef, jobRef.collection('outputs').doc(sourceOutputId), db.collection('users').doc(uid),
    );
    if (!snapshot.exists) throw new HttpsError('not-found', 'Trabajo no encontrado.');
    const job = { ...snapshot.data(), id: snapshot.id } as Job;
    if (job.status === 'pending' || job.status === 'processing') {
      throw new HttpsError('failed-precondition', 'Espera a que termine la generación antes de editar.');
    }
    const source = (sourceSnapshot.exists ? { ...sourceSnapshot.data(), id: sourceSnapshot.id }
      : [job.currentOutput, job.userSelectedOutput, job.retainedApprovedOutput].find(output => output?.id === sourceOutputId)) as JobOutput | undefined;
    if (!source || source.jobId !== jobId || source.clientId !== job.clientId || source.batchId !== job.batchId) {
      throw new HttpsError('not-found', 'No encontramos esa versión dentro de este trabajo.');
    }
    if (!source.resultImagePath || source.storageDeletedAt) {
      throw new HttpsError('failed-precondition', 'La foto de partida ya no está disponible.');
    }
    const imageConfig = (job.photoProfile ? resolveCommercialPhotoConfig : normalizeProviderImageConfig)(
      provider, source.imageConfig, source.aspectRatio,
    );
    const imageEdit = {
      sourceOutputId, sourceImagePath: source.resultImagePath, instructions, requestedByUid: uid,
      requestedAt: now, provider, ...imageConfig,
    };
    const displayName = userSnapshot.get('displayName');
    tx.update(jobRef, {
      imageEdit,
      ...(job.automationJobId ? { automationManaged: false, automationReviewPending: false, automationGate: null } : {}),
      status: 'pending', queuePriority: 1, retryCount: 0, retryNotBefore: null,
      maxRetries: config.jobMaxRetries, generationAttemptCount: 0,
      claimToken: null, claimedBy: null, claimExpiresAt: null, timeoutAt: null,
      startedAt: null, lastAttemptStartedAt: null, completedAt: null, latestAutoReview: null,
      lastError: null, failureInfo: null,
      manualRegenerationCount: FieldValue.increment(1),
      ...buildRegenerationReviewSignalsPatch({ job, uid, displayName: typeof displayName === 'string' ? displayName : null }),
      updatedAt: now,
    });
    tx.create(jobRef.collection('logs').doc(), {
      type: 'system', level: 'info', message: 'Edición de foto encolada desde el catálogo.',
      outputId: sourceOutputId, payload: imageEdit, createdAt: now,
    });
  });
  return { success: true, jobId };
});
