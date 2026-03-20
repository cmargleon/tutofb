import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const createGenerationBatch = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in');
  }

  const { clientId, modelId, poseIds, garments, provider, promptBase, aspectRatio, backgroundConfig } = request.data;
  
  if (!clientId || !modelId || !poseIds || !garments || !provider || !aspectRatio || !backgroundConfig) {
    throw new HttpsError('invalid-argument', 'Missing required fields');
  }

  if (!Array.isArray(poseIds) || poseIds.length === 0) {
    throw new HttpsError('invalid-argument', 'poseIds must be a non-empty array');
  }

  if (!Array.isArray(garments) || garments.length === 0) {
    throw new HttpsError('invalid-argument', 'garments must be a non-empty array');
  }

  // Limit max jobs to prevent abuse
  const totalJobs = poseIds.length * garments.length;
  if (totalJobs > 100) {
    throw new HttpsError('out-of-range', 'Batch size exceeds maximum limit of 100 jobs');
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

  if (modelData.clientId !== clientId) {
    throw new HttpsError('permission-denied', 'Model does not belong to the specified client');
  }

  // 2. Create Batch
  const batchRef = db.collection('batches').doc();
  const batchData = {
    clientId,
    clientNameSnapshot: clientData.name,
    modelId,
    modelNameSnapshot: modelData.name,
    poseIds,
    garmentCount: garments.length,
    totalJobs,
    pendingJobs: totalJobs,
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
    if (!pose) {
      throw new HttpsError('invalid-argument', `Pose ${poseId} not found in model`);
    }

    for (const garment of garments) {
      const jobRef = db.collection('jobs').doc();
      
      // Generate final prompt
      let finalPrompt = promptBase ? `${promptBase}. ` : '';
      finalPrompt += `A model wearing ${garment.name}. `;
      if (backgroundConfig.type === 'studio') {
        finalPrompt += 'Studio lighting, neutral background.';
      } else if (backgroundConfig.type === 'outdoor') {
        finalPrompt += 'Outdoor setting, natural lighting.';
      } else if (backgroundConfig.type === 'custom' && backgroundConfig.description) {
        finalPrompt += `${backgroundConfig.description}.`;
      } else if (backgroundConfig.type === 'none') {
        finalPrompt += 'White background.';
      }

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
        aspectRatio: aspectRatio,
        provider: provider,
        promptBase: promptBase || '',
        finalPrompt: finalPrompt.trim(),
        backgroundConfig: backgroundConfig,
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
