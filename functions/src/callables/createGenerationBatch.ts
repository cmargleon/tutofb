import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const createGenerationBatch = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in');
  }

  const { clientId, modelId, poseIds, garments } = request.data;
  
  if (!clientId || !modelId || !poseIds || !garments) {
    throw new HttpsError('invalid-argument', 'Missing required fields');
  }

  const db = admin.firestore();
  
  // 1. Validate client and model exist
  const clientRef = db.collection('clients').doc(clientId);
  const modelRef = db.collection('models').doc(modelId);
  
  const [clientSnap, modelSnap] = await Promise.all([clientRef.get(), modelRef.get()]);
  
  if (!clientSnap.exists || !modelSnap.exists) {
    throw new HttpsError('not-found', 'Client or Model not found');
  }

  const clientData = clientSnap.data()!;
  const modelData = modelSnap.data()!;

  // 2. Create Batch
  const batchRef = db.collection('batches').doc();
  const batchData = {
    clientId,
    clientNameSnapshot: clientData.name,
    modelId,
    modelNameSnapshot: modelData.name,
    poseIds,
    garmentCount: garments.length,
    totalJobs: poseIds.length * garments.length,
    pendingJobs: poseIds.length * garments.length,
    processingJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    status: 'pending',
    latestJobCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: request.auth.uid
  };

  const batch = db.batch();
  batch.set(batchRef, batchData);

  // 3. Create Jobs
  for (const poseId of poseIds) {
    const pose = modelData.poses.find((p: any) => p.id === poseId);
    if (!pose) continue;

    for (const garment of garments) {
      const jobRef = db.collection('jobs').doc();
      batch.set(jobRef, {
        batchId: batchRef.id,
        clientId,
        clientNameSnapshot: clientData.name,
        modelId,
        modelNameSnapshot: modelData.name,
        poseImageId: pose.id,
        poseImagePath: pose.storagePath,
        garmentId: garment.id,
        garmentName: garment.name,
        garmentFilePath: garment.storagePath,
        garmentIsMultiAngle: garment.isMultiAngle || false,
        aspectRatio: '3:4', // Default
        provider: 'fal-seedream', // Default
        promptBase: 'A photo of a model wearing a garment',
        finalPrompt: 'A photo of a model wearing a garment',
        backgroundConfig: 'studio',
        status: 'pending',
        queuePriority: 10,
        retryCount: 0,
        startedAt: null,
        completedAt: null,
        currentOutputId: null,
        currentOutput: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByUid: request.auth.uid,
        lastError: null
      });
    }
  }

  // 4. Update Client batch count
  batch.update(clientRef, {
    batchCount: admin.firestore.FieldValue.increment(1),
    lastBatchCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await batch.commit();

  return { batchId: batchRef.id };
});
