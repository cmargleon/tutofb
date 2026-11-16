import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  JOB_REJECTION_REASONS, MAX_JOB_REVIEW_NOTE,
  type Job, type JobOutput, type JobRejectionFeedback,
  type RecordJobRejectionRequest, type RecordJobRejectionResponse,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';

export const recordJobRejection = onCall<RecordJobRejectionRequest, Promise<RecordJobRejectionResponse>>(async request => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  const jobId = validId(request.data?.jobId);
  const outputId = validId(request.data?.outputId);
  const { reasons, note } = request.data;
  if (!Array.isArray(reasons) || !reasons.length || reasons.length > JOB_REJECTION_REASONS.length
    || reasons.some(reason => !JOB_REJECTION_REASONS.includes(reason))) {
    throw new HttpsError('invalid-argument', 'Selecciona uno o más motivos de rechazo válidos.');
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > MAX_JOB_REVIEW_NOTE)) {
    throw new HttpsError('invalid-argument', 'La nota de rechazo no es válida.');
  }

  const uid = request.auth!.uid;
  const db = getAppFirestore();
  const jobRef = db.collection('jobs').doc(jobId);
  const outputRef = jobRef.collection('outputs').doc(outputId);
  const logRef = jobRef.collection('logs').doc();
  await db.runTransaction(async tx => {
    const [jobSnap, outputSnap, author] = await tx.getAll(jobRef, outputRef, db.collection('users').doc(uid));
    const job = jobSnap.data() as Job | undefined;
    // Some legacy jobs only have the output embedded on the job document.
    const output = (outputSnap.data() as JobOutput | undefined)
      ?? [job?.currentOutput, job?.userSelectedOutput, job?.retainedApprovedOutput].find(item => item?.id === outputId);
    if (!job || !output?.resultImagePath || output.storageDeletedAt) {
      throw new HttpsError('not-found', 'El resultado ya no está disponible en este trabajo.');
    }
    const displayName = author.get('displayName');
    const humanFeedback: JobRejectionFeedback = {
      jobId, outputId, reasons: [...new Set(reasons)], note: note?.trim() || null,
      clientId: job.clientId, batchId: job.batchId, garmentId: job.garmentId,
      generationKind: job.generationKind || 'garment',
      garmentBodyArea: job.garmentBodyArea ?? null, productScene: job.productScene ?? null,
      provider: output.provider ?? null, aspectRatio: output.aspectRatio ?? null, imageConfig: output.imageConfig ?? null,
      photoProfile: output.photoProfile ?? null, generationAttempt: output.generationAttempt ?? null,
      authorUid: uid, authorDisplayName: typeof displayName === 'string' ? displayName : null,
    };
    tx.create(logRef, {
      type: 'system', level: 'info', outputId, humanFeedback,
      message: 'Se registraron motivos de rechazo en la revisión humana.',
      payload: { requestedByUid: uid, requestedByDisplayName: humanFeedback.authorDisplayName },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { feedbackId: logRef.id };
});
