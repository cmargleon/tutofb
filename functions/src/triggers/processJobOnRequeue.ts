import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

export const processJobOnRequeue = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const before = snapshot.before.data();
  const after = snapshot.after.data();

  if (before.status !== 'pending' && after.status === 'pending') {
    // Re-process job here
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
          id: 'output-2',
          provider: after.provider,
          prompt: after.finalPrompt,
          resultImagePath: 'generated/dummy2.png',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        }
      });
    }, 5000);
  }
});
