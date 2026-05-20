import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Batch, CancelJobGenerationRequest, CancelJobGenerationResponse, Job } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { buildManualCancellationFailureInfo, toFailureSummary } from '../errors/jobFailure';
import { getAppFirestore } from '../firebase/appFirestore';
import { syncProductDraftImagesForGarment } from '../spreadsheets/syncProductDraftImages';

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
    await db.runTransaction(async (transaction) => {
      const latestSnapshot = await transaction.get(jobRef);
      if (!latestSnapshot.exists) {
        throw new HttpsError('not-found', 'Trabajo no encontrado.');
      }

      const latestJob = { id: latestSnapshot.id, ...latestSnapshot.data() } as Job;
      if (latestJob.status !== 'pending' && latestJob.status !== 'processing') {
        throw new HttpsError(
          'failed-precondition',
          'Solo puedes cancelar trabajos que estén pendientes o en procesamiento.',
        );
      }

      const latestWasProcessing = latestJob.status === 'processing';
      const failureInfo = buildManualCancellationFailureInfo({
        userMessage: latestWasProcessing
          ? 'El job fue cancelado manualmente mientras se estaba generando.'
          : 'El job fue cancelado manualmente antes de iniciar la generación.',
        technicalMessage: latestWasProcessing
          ? 'Se canceló el job durante la etapa de generación. Los resultados tardíos del proveedor serán ignorados.'
          : 'Se canceló el job antes de que el worker reclamara la tarea.',
      });

      transaction.update(jobRef, {
        status: 'failed',
        queuePriority: 0,
        claimToken: null,
        claimedBy: null,
        claimExpiresAt: null,
        timeoutAt: null,
        retryNotBefore: null,
        startedAt: null,
        completedAt: null,
        currentOutputId: null,
        currentOutput: null,
        userSelectedOutputId: null,
        userSelectedOutput: null,
        updatedAt: now,
        lastError: toFailureSummary(failureInfo),
        failureInfo,
      });

      if (latestJob.currentOutputId) {
        transaction.set(
          jobRef.collection('outputs').doc(latestJob.currentOutputId),
          { isCurrent: false },
          { merge: true },
        );
      }

      transaction.set(jobRef.collection('logs').doc(), {
        type: 'system',
        level: 'warn',
        message: latestWasProcessing
          ? 'Se canceló manualmente el job durante la generación. Los resultados tardíos serán ignorados.'
          : 'Se canceló manualmente el job pendiente antes de ser reclamado por el worker.',
        payload: {
          requestedByUid: request.auth!.uid,
          requestedByDisplayName,
          source: 'evaluation_cancel_job',
          previousStatus: latestJob.status,
          failureInfo,
        },
        createdAt: now,
      });
    });

    if (job.batchId && job.garmentId) {
      const batchSnapshot = await db.collection('batches').doc(job.batchId).get();
      const batch = batchSnapshot.exists ? ({ id: batchSnapshot.id, ...batchSnapshot.data() } as Batch) : null;

      if (batch?.spreadsheetTemplateId) {
        await syncProductDraftImagesForGarment({
          db,
          batchId: job.batchId,
          garmentId: job.garmentId,
          requestedByUid: request.auth!.uid,
          batch,
        });
      }
    }

    return {
      success: true,
      jobId,
    };
  },
);
