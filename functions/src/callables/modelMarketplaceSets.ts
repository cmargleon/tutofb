import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { ApproveModelIdentityRequest, GenerateModelBaseRequest, Model, ModelPhotoSetsRequest, VerifyModelBaseRequest } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { FAL_KEY, GEMINI_API_KEY } from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import { generateModelBaseCore, loadModelSetContext, modelAssetFingerprint, verifyModelBaseCore } from '../models/marketplaceSets';

export const previewModelPhotoSets = onCall<ModelPhotoSetsRequest>(async request => {
  await assertCallableRoles(request, ['admin']);
  return (await loadModelSetContext(request.data, request.auth!.uid)).preview;
});
export const approveModelIdentity = onCall<ApproveModelIdentityRequest>(async request => {
  await assertCallableRoles(request, ['admin']);
  const { modelId, poseId, performer } = request.data;
  if (typeof modelId !== 'string' || !/^[\w-]{1,160}$/.test(modelId) || !['real', 'synthetic'].includes(performer)) throw new HttpsError('invalid-argument', 'Identidad inválida.');
  const db = getAppFirestore(), ref = db.doc(`models/${modelId}`);
  const model = (await ref.get()).data() as Model;
  if (!model || model.status === 'archived') throw new HttpsError('not-found', 'Modelo no disponible.');
  await assertHumanClientAccess(request.auth!.uid, model.clientId);
  const pose = model.poses.find(p => p.id === poseId && p.active !== false);
  if (!pose) throw new HttpsError('invalid-argument', 'Selecciona una foto del propio modelo.');
  const fingerprint = await modelAssetFingerprint(pose.storagePath);
  const identity = { ...fingerprint, traitsSnapshot: model.identityTraits || null, poseId, storagePath: pose.storagePath, performer, approvedByUid: request.auth!.uid, approvedAt: new Date().toISOString() };
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Model;
    if (current?.clientId !== model.clientId || current.poses.find(p => p.id === poseId)?.storagePath !== pose.storagePath) throw new HttpsError('aborted', 'La foto cambió.');
    tx.update(ref, { approvedIdentity: identity, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return identity;
});
export const verifyModelMarketplaceBase = onCall<VerifyModelBaseRequest>({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300 }, async request => {
  await assertCallableRoles(request, ['admin']);
  return verifyModelBaseCore(request.data, request.auth!.uid);
});
export const generateModelMarketplaceBase = onCall<GenerateModelBaseRequest>({ secrets: [FAL_KEY, GEMINI_API_KEY], timeoutSeconds: 540, memory: '1GiB' }, async request => {
  await assertCallableRoles(request, ['admin']);
  return generateModelBaseCore(request.data, request.auth!.uid);
});
