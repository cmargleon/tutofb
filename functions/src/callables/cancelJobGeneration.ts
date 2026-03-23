import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { CancelJobGenerationRequest, CancelJobGenerationResponse, Job } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

export const cancelJobGeneration = onCall<CancelJobGenerationRequest, Promise<CancelJobGenerationResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

    const jobId = typeof request.data?.jobId === 'string' ? request.data.jobId.trim() : '';
    if (!jobId) {
      throw new HttpsError('invalid-argument', 'Debes indicar un trabajo válido.');
    }

    const db = getAppFirestore();
    const jobRef = db.collection('jobs').doc(jobId);
    const userRef = db.collection('users').doc(request.auth!.uid);
    const [jobSnapshot, userSnapshot] = await Promise.all([jobRef.get(), userRef.get()]);

    if (!jobSnapshot.exists) {
      throw new HttpsError('not-found', 'Trabajo no encontrado.');
    }

    const job = { id: jobSnapshot.id, ...jobSnapshot.data() } as Job;
    if (job.status !== 'pending' && job.status !== 'processing') {
      throw new HttpsError(
        'failed-precondition',
        'Solo puedes cancelar trabajos que estén pendientes o en procesamiento.',
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const requestedByDisplayName =
      userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data()!.displayName
        : null;
    const wasProcessing = job.status === 'processing';

    await jobRef.update({
      status: 'failed',
      queuePriority: 0,
      claimToken: null,
      claimedBy: null,
      claimExpiresAt: null,
      timeoutAt: null,
      startedAt: null,
      updatedAt: now,
      lastError: wasProcessing
        ? 'Cancelado manualmente mientras se estaba generando.'
        : 'Cancelado manualmente antes de comenzar la generación.',
    });

    await jobRef.collection('logs').add({
      type: 'system',
      level: 'warn',
      message: wasProcessing
        ? 'Se canceló manualmente el job durante la generación. Los resultados tardíos serán ignorados.'
        : 'Se canceló manualmente el job pendiente antes de ser reclamado por el worker.',
      payload: {
        requestedByUid: request.auth!.uid,
        requestedByDisplayName,
        source: 'evaluation_cancel_job',
        previousStatus: job.status,
      },
      createdAt: now,
    });

    return {
      success: true,
      jobId,
    };
  },
);
