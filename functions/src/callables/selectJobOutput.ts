import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Job, JobOutput, ProductDraft, SelectJobOutputRequest, SelectJobOutputResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { ensureStorageDownloadUrl } from '../firebase/storageDownloadUrl';
import { buildClearSelectionReviewSignalsPatch, buildSelectOutputReviewSignalsPatch } from '../review/reviewSignals';

export const selectJobOutput = onCall<SelectJobOutputRequest, Promise<SelectJobOutputResponse>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

  const jobId = typeof request.data?.jobId === 'string' ? request.data.jobId.trim() : '';
  const rawOutputId = typeof request.data?.outputId === 'string' ? request.data.outputId.trim() : '';
  const outputId = rawOutputId || null;

  if (!jobId) {
    throw new HttpsError('invalid-argument', 'Debes indicar un trabajo para guardar la selección.');
  }

  const db = getAppFirestore();
  const jobRef = db.collection('jobs').doc(jobId);
  const userRef = db.collection('users').doc(request.auth!.uid);
  const [jobSnapshot, userSnapshot] = await Promise.all([jobRef.get(), userRef.get()]);

  if (!jobSnapshot.exists) {
    throw new HttpsError('not-found', 'Trabajo no encontrado.');
  }

  const job = { id: jobSnapshot.id, ...jobSnapshot.data() } as Job;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const requestedByDisplayName =
    userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
      ? userSnapshot.data()!.displayName
      : null;
  const productDraftRef = job.batchId && job.productDraftId
    ? db.collection('batches').doc(job.batchId).collection('productDrafts').doc(job.productDraftId)
    : null;

  if (!outputId) {
    await jobRef.update({
      userSelectedOutputId: null,
      userSelectedOutput: null,
      ...buildClearSelectionReviewSignalsPatch({
        job,
        uid: request.auth!.uid,
        displayName: requestedByDisplayName,
      }),
      updatedAt: now,
    });

    await jobRef.collection('logs').add({
      type: 'system',
      level: 'info',
      message: 'Se restableció la salida aprobada automática del job.',
      payload: {
        requestedByUid: request.auth!.uid,
        requestedByDisplayName,
        previousOutputId: job.userSelectedOutputId || null,
      },
      createdAt: now,
    });

    if (productDraftRef) {
      const draftSnapshot = await productDraftRef.get();
      if (draftSnapshot.exists) {
        const productDraft = { id: draftSnapshot.id, ...draftSnapshot.data() } as ProductDraft;
        await productDraftRef.update({
          generatedImages: (productDraft.generatedImages || []).filter((entry) => entry.jobId !== job.id),
          updatedAt: now,
          updatedByUid: request.auth!.uid,
        });
      }
    }

    return {
      success: true,
      jobId,
      outputId: null,
    };
  }

  const outputSnapshot = await jobRef.collection('outputs').doc(outputId).get();
  if (!outputSnapshot.exists) {
    throw new HttpsError('not-found', 'La miniatura seleccionada ya no existe dentro de este job.');
  }

  const output = { id: outputSnapshot.id, ...outputSnapshot.data() } as JobOutput;
  if (!output.resultImagePath) {
    throw new HttpsError('failed-precondition', 'La salida seleccionada todavía no tiene una imagen disponible.');
  }
  const draftSnapshot = productDraftRef ? await productDraftRef.get() : null;
  const downloadUrl = await ensureStorageDownloadUrl(output.resultImagePath);

  await jobRef.update({
    userSelectedOutputId: output.id,
    userSelectedOutput: output,
    status: 'completed',
    completedAt: now,
    lastError: null,
    'traceability.lastCompletedAt': now,
    'traceability.lastProviderErrorAt': null,
    'traceability.lastProviderErrorMessage': null,
    ...buildSelectOutputReviewSignalsPatch({
      job,
      output,
      uid: request.auth!.uid,
      displayName: requestedByDisplayName,
    }),
    updatedAt: now,
  });

  if (productDraftRef && draftSnapshot?.exists) {
    const productDraft = { id: draftSnapshot.id, ...draftSnapshot.data() } as ProductDraft;
    const nextGeneratedImages = [
      ...(productDraft.generatedImages || []).filter((entry) => entry.jobId !== job.id),
      {
        jobId: job.id!,
        outputId: output.id,
        poseId: job.poseImageId || null,
        label: job.poseFileName || `Pose ${job.poseImageId}`,
        storagePath: output.resultImagePath,
        downloadUrl,
        selectedAt: now,
      },
    ];

    await productDraftRef.update({
      generatedImages: nextGeneratedImages,
      updatedAt: now,
      updatedByUid: request.auth!.uid,
    });
  }

  await jobRef.collection('logs').add({
    type: job.status === 'completed' ? 'system' : 'completed',
    level: 'info',
    message:
      job.status === 'completed'
        ? 'Usuario marcó manualmente una salida como aprobada.'
        : 'Usuario aprobó manualmente una salida y el job quedó completado.',
    outputId: output.id,
    payload: {
      requestedByUid: request.auth!.uid,
      requestedByDisplayName,
      outputId: output.id,
      generationAttempt: output.generationAttempt || null,
      previousOutputId: job.userSelectedOutputId || null,
      previousStatus: job.status,
      currentOutputId: job.currentOutput?.id || null,
      currentOutputGeminiVerdict: job.currentOutput?.autoReview?.verdict || job.latestAutoReview?.verdict || null,
      selectedOutputGeminiVerdict: output.autoReview?.verdict || null,
    },
    createdAt: now,
  });

  return {
    success: true,
    jobId,
    outputId: output.id,
  };
});
