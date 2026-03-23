import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Job, JobOutput, SelectJobOutputRequest, SelectJobOutputResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

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

  if (!outputId) {
    await jobRef.update({
      userSelectedOutputId: null,
      userSelectedOutput: null,
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

  await jobRef.update({
    userSelectedOutputId: output.id,
    userSelectedOutput: output,
    updatedAt: now,
  });

  await jobRef.collection('logs').add({
    type: 'system',
    level: 'info',
    message: 'Usuario marcó manualmente una salida como aprobada.',
    outputId: output.id,
    payload: {
      requestedByUid: request.auth!.uid,
      requestedByDisplayName,
      outputId: output.id,
      generationAttempt: output.generationAttempt || null,
      previousOutputId: job.userSelectedOutputId || null,
    },
    createdAt: now,
  });

  return {
    success: true,
    jobId,
    outputId: output.id,
  };
});
