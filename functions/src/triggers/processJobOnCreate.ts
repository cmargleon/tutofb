import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

export const processJobOnCreate = onDocumentCreated('jobs/{jobId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const job = snapshot.data();
  if (job.status !== 'pending') return;

  // Process job here (call AI provider)
  // For now, just simulate processing
  const db = admin.firestore();
  const jobRef = db.collection('jobs').doc(event.params.jobId);

  await jobRef.update({
    status: 'processing',
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Simulate completion
  setTimeout(async () => {
    await jobRef.update({
      status: 'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      currentOutput: {
        id: 'output-1',
        provider: job.provider,
        prompt: job.finalPrompt,
        resultImagePath: 'generated/dummy.png',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }
    });
  }, 5000);
});
