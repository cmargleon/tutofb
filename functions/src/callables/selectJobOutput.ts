import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Job, JobOutput, SelectJobOutputRequest, SelectJobOutputResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';
import { buildClearSelectionReviewSignalsPatch, buildSelectOutputReviewSignalsPatch } from '../review/reviewSignals';
import { syncProductDraftImagesForGarment } from '../spreadsheets/syncProductDraftImages';

export const selectJobOutput = onCall<SelectJobOutputRequest, Promise<SelectJobOutputResponse>>(async request => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  const uid = request.auth!.uid;
  const jobId = validId(request.data?.jobId);
  const outputId = request.data.outputId === null ? null : validId(request.data.outputId);

  const db = getAppFirestore();
  const jobRef = db.collection('jobs').doc(jobId);
  const outputRef = outputId ? jobRef.collection('outputs').doc(outputId) : null;
  const logRef = jobRef.collection('logs').doc();
  const now = FieldValue.serverTimestamp();
  const job = await db.runTransaction(async tx => {
    const [jobSnapshot, userSnapshot] = await tx.getAll(jobRef, db.collection('users').doc(uid));
    if (!jobSnapshot.exists) throw new HttpsError('not-found', 'Trabajo no encontrado.');
    const job = { ...jobSnapshot.data(), id: jobSnapshot.id } as Job;
    if (job.status === 'pending' || job.status === 'processing') {
      throw new HttpsError('failed-precondition', 'Espera a que termine la generación para cambiar la selección.');
    }

    const displayName = userSnapshot.get('displayName');
    const actor = { job, uid, displayName: typeof displayName === 'string' ? displayName : null };
    const audit = { requestedByUid: uid, requestedByDisplayName: actor.displayName, previousOutputId: job.userSelectedOutputId || job.retainedApprovedOutput?.id || null };

    if (!outputRef) {
      tx.update(jobRef, {
        userSelectedOutputId: null, userSelectedOutput: null, retainedApprovedOutput: null,
        ...buildClearSelectionReviewSignalsPatch(actor), updatedAt: now,
      });
      tx.create(logRef, {
        type: 'system', level: 'info', message: 'Se restableció la salida aprobada automática del job.',
        payload: audit, createdAt: now,
      });
      return job;
    }

    const outputSnapshot = await tx.get(outputRef);
    const output = outputSnapshot.exists
      ? { ...outputSnapshot.data(), id: outputSnapshot.id } as JobOutput
      : [job.currentOutput, job.userSelectedOutput, job.retainedApprovedOutput].find(item => item?.id === outputId);
    if (!output) throw new HttpsError('not-found', 'La miniatura seleccionada ya no existe dentro de este job.');
    if (!output.resultImagePath || output.storageDeletedAt) {
      throw new HttpsError('failed-precondition', 'La salida seleccionada no tiene una imagen disponible.');
    }

    tx.update(jobRef, {
      userSelectedOutputId: output.id, userSelectedOutput: output, retainedApprovedOutput: null,
      status: 'completed', completedAt: now, lastError: null, failureInfo: null,
      'traceability.lastCompletedAt': now,
      'traceability.lastProviderErrorAt': null,
      'traceability.lastProviderErrorMessage': null,
      ...buildSelectOutputReviewSignalsPatch({ ...actor, output }), updatedAt: now,
    });
    tx.create(logRef, {
      type: job.status === 'completed' ? 'system' : 'completed', level: 'info',
      message: job.status === 'completed'
        ? 'Usuario marcó manualmente una salida como aprobada.'
        : 'Usuario aprobó manualmente una salida y el job quedó completado.',
      outputId: output.id,
      payload: {
        ...audit, outputId: output.id, generationAttempt: output.generationAttempt || null,
        previousStatus: job.status, currentOutputId: job.currentOutput?.id || null,
        currentOutputGeminiVerdict: job.currentOutput?.autoReview?.verdict || job.latestAutoReview?.verdict || null,
        selectedOutputGeminiVerdict: output.autoReview?.verdict || null,
      },
      createdAt: now,
    });
    return job;
  });

  if (job.batchId && job.garmentId && job.productDraftId) {
    await syncProductDraftImagesForGarment({ db, batchId: job.batchId, garmentId: job.garmentId, requestedByUid: uid });
  }
  return { success: true, jobId, outputId };
});
