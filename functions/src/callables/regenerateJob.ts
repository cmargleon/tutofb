import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const regenerateJob = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in');
  }

  const { jobId, provider, prompt } = request.data;
  
  if (!jobId || !provider || !prompt) {
    throw new HttpsError('invalid-argument', 'Missing required fields');
  }

  const db = admin.firestore();
  const jobRef = db.collection('jobs').doc(jobId);
  
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new HttpsError('not-found', 'Job not found');
  }

  // Update job to pending
  await jobRef.update({
    status: 'pending',
    provider,
    finalPrompt: prompt,
    queuePriority: 100, // High priority for regenerations
    retryCount: 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true };
});
