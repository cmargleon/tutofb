import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Job, RegenerateJobRequest, RegenerateJobResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { buildRegenerateJobPatch } from './regenerateJob.helpers';

export const regenerateJob = onCall<RegenerateJobRequest, Promise<RegenerateJobResponse>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

  const jobId = typeof request.data?.jobId === 'string' ? request.data.jobId.trim() : '';
  const provider = request.data?.provider;
  const prompt = typeof request.data?.prompt === 'string' ? request.data.prompt.trim() : '';

  if (!jobId) {
    throw new HttpsError('invalid-argument', 'Debes indicar un trabajo para regenerar.');
  }

  const db = admin.firestore();
  const jobRef = db.collection('jobs').doc(jobId);
  const snapshot = await jobRef.get();

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

  const now = admin.firestore.FieldValue.serverTimestamp();
  try {
    await jobRef.update({
      ...buildRegenerateJobPatch(job, provider || '', prompt),
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
