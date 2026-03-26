import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Job, RegenerateJobsBulkRequest, RegenerateJobsBulkResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { buildRegenerateJobPatch } from './regenerateJob.helpers';
import { buildRegenerationReviewSignalsPatch } from '../review/reviewSignals';

const MAX_BULK_JOBS = 50;

export const regenerateJobsBulk = onCall<RegenerateJobsBulkRequest, Promise<RegenerateJobsBulkResponse>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

  const requestedJobs = Array.isArray(request.data?.jobs) ? request.data.jobs : [];
  const normalizedJobs = requestedJobs
    .map((entry) => ({
      jobId: typeof entry?.jobId === 'string' ? entry.jobId.trim() : '',
      provider: typeof entry?.provider === 'string' ? entry.provider.trim() : '',
      prompt: typeof entry?.prompt === 'string' ? entry.prompt.trim() : '',
    }))
    .filter((entry) => entry.jobId);

  if (normalizedJobs.length === 0) {
    throw new HttpsError('invalid-argument', 'Debes indicar al menos un job para reencolar.');
  }

  if (normalizedJobs.length > MAX_BULK_JOBS) {
    throw new HttpsError('invalid-argument', `Solo puedes reencolar hasta ${MAX_BULK_JOBS} jobs por acción.`);
  }

  const db = getAppFirestore();
  const userSnapshot = await db.collection('users').doc(request.auth!.uid).get();
  const requestedByDisplayName =
    userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
      ? userSnapshot.data()!.displayName
      : null;

  const uniqueJobIds = Array.from(new Set(normalizedJobs.map((entry) => entry.jobId)));
  const jobRefs = uniqueJobIds.map((jobId) => db.collection('jobs').doc(jobId));
  const jobSnapshots = await db.getAll(...jobRefs);
  const jobsById = Object.fromEntries(
    jobSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, { id: snapshot.id, ...snapshot.data() } as Job]),
  ) as Record<string, Job>;

  const writeBatch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const skippedJobIds: string[] = [];
  let queuedJobs = 0;

  for (const entry of normalizedJobs) {
    const job = jobsById[entry.jobId];
    if (!job || job.status === 'processing') {
      skippedJobIds.push(entry.jobId);
      continue;
    }

    const provider = entry.provider || job.provider;
    const prompt = entry.prompt || (job.promptBase || job.finalPrompt || '').trim();

    try {
      const patch = buildRegenerateJobPatch(job, provider, prompt);
      const jobRef = db.collection('jobs').doc(job.id!);

      writeBatch.update(jobRef, {
        ...patch,
        manualRegenerationCount: admin.firestore.FieldValue.increment(1),
        ...buildRegenerationReviewSignalsPatch({
          job,
          uid: request.auth!.uid,
          displayName: requestedByDisplayName,
        }),
        'traceability.lastManualRegenerationAt': now,
        'traceability.lastManualRegeneratedByUid': request.auth!.uid,
        'traceability.lastManualRegeneratedByDisplayName': requestedByDisplayName,
        updatedAt: now,
      });

      writeBatch.set(jobRef.collection('logs').doc(), {
        type: 'system',
        level: 'info',
        message: 'Regeneración masiva encolada desde la aplicación.',
        payload: {
          requestedByUid: request.auth!.uid,
          requestedByDisplayName,
          source: 'bulk_regeneration',
          provider,
          prompt,
          currentOutputId: job.currentOutput?.id || null,
          currentOutputGeminiVerdict: job.currentOutput?.autoReview?.verdict || job.latestAutoReview?.verdict || null,
        },
        createdAt: now,
      });

      queuedJobs += 1;
    } catch {
      skippedJobIds.push(entry.jobId);
    }
  }

  if (queuedJobs > 0) {
    await writeBatch.commit();
  }

  return {
    success: true,
    queuedJobs,
    skippedJobs: skippedJobIds.length,
    skippedJobIds,
  };
});
