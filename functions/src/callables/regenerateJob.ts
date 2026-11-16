import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Job, JobLog, MAX_JOB_REVIEW_CORRECTION, RegenerateJobRequest, RegenerateJobResponse } from '../../../shared/src/types';
import { getApprovedReviewOutput, getJobRegenerationBasePrompt } from '../../../shared/src/jobReview';
import { assertCallableRoles } from '../auth/roles';
import { buildRegenerateJobPatch } from './regenerateJob.helpers';
import { getAppFirestore } from '../firebase/appFirestore';
import { buildRegenerationReviewSignalsPatch } from '../review/reviewSignals';
import { assertProviderEnabledInSystemConfig, getSystemConfigCached } from '../admin/systemConfig';
import { validId } from '../manglar/access';

export const regenerateJob = onCall<RegenerateJobRequest, Promise<RegenerateJobResponse>>(async (request) => {
  const role = await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  const jobId = validId(request.data?.jobId);
  const correction = request.data?.correction;
  let correctionText: string | null = null;
  if (correction !== undefined) {
    if (role === 'revisor') throw new HttpsError('permission-denied', 'No tienes permisos para regenerar fotos.');
    if (!correction || typeof correction.text !== 'string' || !correction.text.trim()
      || correction.text.length > MAX_JOB_REVIEW_CORRECTION) {
      throw new HttpsError('invalid-argument', 'Revisa el texto de la corrección antes de regenerar.');
    }
    correctionText = correction.text.trim();
  }

  const systemConfig = await getSystemConfigCached();
  const uid = request.auth!.uid;
  const db = getAppFirestore();
  const jobRef = db.collection('jobs').doc(jobId);
  const userRef = db.collection('users').doc(uid);
  const logRef = jobRef.collection('logs').doc();
  const feedbackRef = correction ? jobRef.collection('logs').doc(validId(correction.feedbackId)) : null;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async tx => {
    const [snapshot, userSnapshot] = await tx.getAll(jobRef, userRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Trabajo no encontrado.');
    const job = { ...snapshot.data(), id: snapshot.id } as Job;
    if (job.status === 'processing' || job.status === 'pending') {
      throw new HttpsError('failed-precondition', 'Este trabajo ya está en cola o se está procesando.');
    }

    const feedback = feedbackRef ? ((await tx.get(feedbackRef)).data() as JobLog | undefined)?.humanFeedback : null;
    if (correction && (!feedback || feedback.jobId !== jobId || feedback.clientId !== job.clientId)) {
      throw new HttpsError('not-found', 'No se encontró el feedback de este trabajo.');
    }

    const provider = correction ? job.provider : (request.data.provider || job.provider);
    const basePrompt = correction ? getJobRegenerationBasePrompt(job) : request.data.prompt;
    const prompt = correctionText
      ? `${basePrompt}\n\nCorrecciones para el siguiente intento (mantener la identidad y las demás instrucciones):\n${correctionText}`
      : typeof basePrompt === 'string' ? basePrompt : '';
    assertProviderEnabledInSystemConfig(provider, systemConfig, 'usar para regenerar');

    let patch;
    try {
      patch = buildRegenerateJobPatch(job, provider, prompt, systemConfig.jobMaxRetries);
    } catch (error) {
      throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'Solicitud inválida.');
    }

    const displayName = userSnapshot.get('displayName');
    const requestedByDisplayName = typeof displayName === 'string' ? displayName : null;
    const approvedOutput = correction ? getApprovedReviewOutput(job) : null;
    tx.update(jobRef, {
      ...patch,
      ...(!job.userSelectedOutput && approvedOutput ? { retainedApprovedOutput: approvedOutput } : {}),
      manualRegenerationCount: admin.firestore.FieldValue.increment(1),
      ...buildRegenerationReviewSignalsPatch({ job, uid, displayName: requestedByDisplayName }),
      'traceability.lastManualRegenerationAt': now,
      'traceability.lastManualRegeneratedByUid': uid,
      'traceability.lastManualRegeneratedByDisplayName': requestedByDisplayName,
      updatedAt: now,
    });
    tx.create(logRef, {
      type: 'system',
      level: 'info',
      message: 'Regeneración encolada desde la aplicación.',
      ...(feedback ? { outputId: feedback.outputId } : {}),
      payload: {
        requestedByUid: uid, requestedByDisplayName, provider, prompt,
        ...(feedback ? { feedbackId: feedbackRef!.id, correction: correctionText } : {}),
        currentOutputId: job.currentOutput?.id || null,
        currentOutputGeminiVerdict: job.currentOutput?.autoReview?.verdict || job.latestAutoReview?.verdict || null,
      },
      createdAt: now,
    });
  });

  return { success: true, jobId };
});
