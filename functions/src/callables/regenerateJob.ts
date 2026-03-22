import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Job, RegenerateJobRequest, RegenerateJobResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { buildRegenerateJobPatch } from './regenerateJob.helpers';
import { getAppFirestore } from '../firebase/appFirestore';

export const regenerateJob = onCall<RegenerateJobRequest, Promise<RegenerateJobResponse>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

  const jobId = typeof request.data?.jobId === 'string' ? request.data.jobId.trim() : '';
  const provider = request.data?.provider;
  const prompt = typeof request.data?.prompt === 'string' ? request.data.prompt.trim() : '';

  if (!jobId) {
    throw new HttpsError('invalid-argument', 'Debes indicar un trabajo para regenerar.');
  }

  const db = getAppFirestore();
  const jobRef = db.collection('jobs').doc(jobId);
  const userRef = db.collection('users').doc(request.auth!.uid);
  const [snapshot, userSnapshot] = await Promise.all([jobRef.get(), userRef.get()]);

  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'Trabajo no encontrado.');
  }

  const job = { id: snapshot.id, ...snapshot.data() } as Job;
  if (job.status === 'processing') {
    throw new HttpsError(
      'failed-precondition',
      'Este trabajo ya se está procesando. Espera a que termine antes de regenerarlo.',
    );
  }

  if (job.experimentEnabled) {
    if (provider !== job.provider) {
      throw new HttpsError(
        'invalid-argument',
        'Los jobs de un experimento A/B deben mantener el modelo asignado a su brazo.',
      );
    }

    if (prompt !== (job.promptBase || '').trim()) {
      throw new HttpsError(
        'invalid-argument',
        'Los jobs de un experimento A/B deben mantener el prompt original para conservar la comparación.',
      );
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const requestedByDisplayName =
    userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
      ? userSnapshot.data()!.displayName
      : null;
  try {
    await jobRef.update({
      ...buildRegenerateJobPatch(job, provider || '', prompt),
      manualRegenerationCount: admin.firestore.FieldValue.increment(1),
      'traceability.lastManualRegenerationAt': now,
      'traceability.lastManualRegeneratedByUid': request.auth!.uid,
      'traceability.lastManualRegeneratedByDisplayName': requestedByDisplayName,
      updatedAt: now,
    });
  } catch (error) {
    throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'Solicitud inválida.');
  }

  await jobRef.collection('logs').add({
    type: 'system',
    level: 'info',
    message: 'Regeneración encolada desde la aplicación.',
    payload: {
        requestedByUid: request.auth!.uid,
        requestedByDisplayName,
        provider,
        prompt,
      },
    createdAt: now,
  });

  return {
    success: true,
    jobId,
  };
});
