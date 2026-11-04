import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { ManglarClientSaveRequest, ManglarModelSaveRequest, ManglarEntityStateRequest, ManglarPoseReplaceRequest, ManglarJobFlagRequest, Model, Pose } from '../../../shared/src/types';
import { assertCallableRoles, assertUserRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { getManglarContext } from './context';
import { validId } from './access';
const nameValue = (value: string) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 500)
        throw new HttpsError('invalid-argument', 'Indica un nombre válido.');
    return value.trim();
};
export const saveClientService = async (input: ManglarClientSaveRequest, uid: string) => {
    await assertUserRoles(uid, undefined, ['admin']);
    const db = getAppFirestore();
    const ref = input.id ? db.collection('clients').doc(validId(input.id)) : db.collection('clients').doc();
    const name = nameValue(input.name);
    if (input.generationPromptBase != null && (typeof input.generationPromptBase !== 'string' || input.generationPromptBase.length > 30000))
        throw new HttpsError('invalid-argument', 'Prompt inválido.');
    await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        const now = FieldValue.serverTimestamp();
        tx.set(ref, { name, generationPromptBase: input.generationPromptBase?.trim() || null, updatedAt: now,
            ...(!current.exists ? { status: 'active', archivedAt: null, archivedByUid: null, createdAt: now, batchCount: 0, lastBatchCreatedAt: null, createdByUid: uid } : {}) }, { merge: true });
    });
    return { id: ref.id };
};
export const setCatalogArchivedService = async (collection: 'clients' | 'models', input: ManglarEntityStateRequest, uid: string, archived: boolean) => {
    await assertUserRoles(uid, undefined, ['admin']);
    await getAppFirestore().collection(collection).doc(validId(input.id)).update({ status: archived ? 'archived' : 'active',
        archivedAt: archived ? FieldValue.serverTimestamp() : null, archivedByUid: archived ? uid : null, updatedAt: FieldValue.serverTimestamp() });
    return { id: input.id, status: archived ? 'archived' : 'active' };
};
export const saveModelService = async (input: ManglarModelSaveRequest, uid: string) => {
    await assertUserRoles(uid, undefined, ['admin']);
    const name = nameValue(input.name);
    const db = getAppFirestore();
    const ref = input.id ? db.collection('models').doc(validId(input.id)) : db.collection('models').doc();
    const originalModel = (await ref.get()).data() as Model | undefined;
    const originalRoot = originalModel?.storageRootPath || (originalModel ? `models/${originalModel.clientId}/${ref.id}` : null);
    const additions = input.posesToAdd || [];
    if (additions.length > 100 || (input.poseIdsToRemove?.length || 0) > 100)
        throw new HttpsError('invalid-argument', 'Máximo 100 poses por edición.');
    const nextPoses: Pose[] = [];
    // Files are uploaded/imported through the existing Storage paths before this operation.
    for (const pose of additions) {
        if (!pose.storagePath || /[\\%?#]/.test(pose.storagePath) || pose.storagePath.split('/').some((p) => !p || p === '..'))
            throw new HttpsError('invalid-argument', 'Referencia inválida.');
        const allowed = pose.storagePath.startsWith(`garments/drafts/${uid}/`) || pose.storagePath.startsWith(`models/${input.clientId}/${ref.id}/poses/`) || Boolean(originalRoot && pose.storagePath.startsWith(`${originalRoot}/poses/`)) || pose.storagePath.startsWith(`model_generations/${input.clientId}/`);
        if (!allowed)
            throw new HttpsError('permission-denied', 'Referencia ajena al modelo.');
        const [metadata] = await admin.storage().bucket().file(pose.storagePath).getMetadata();
        if (!metadata.contentType?.startsWith('image/') || Number(metadata.size) >= 10 * 1024 * 1024)
            throw new HttpsError('invalid-argument', 'Fotografía inválida.');
        const id = randomUUID();
        const fileName = nameValue(pose.fileName);
        let storagePath = pose.storagePath;
        if (storagePath.startsWith(`garments/drafts/${uid}/`)) {
            storagePath = `${originalRoot || `models/${input.clientId}/${ref.id}`}/poses/${id}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180)}`;
            // Copy before committing the model. A concurrent discard either wins before
            // this copy (save fails), or removes only the temporary source afterwards.
            // Pin the validated generation so an overwritten upload cannot slip through.
            await admin.storage().bucket().file(pose.storagePath, { generation: metadata.generation }).copy(admin.storage().bucket().file(storagePath));
        }
        nextPoses.push({ id, storagePath, fileName, aiClassification: pose.aiClassification || null, createdAt: new Date().toISOString() });
    }
    let removed: Pose[] = [];
    await db.runTransaction(async (tx) => {
        const [snapshot, client] = await tx.getAll(ref, db.collection('clients').doc(validId(input.clientId)));
        const model = snapshot.data() as Model | undefined;
        if (!client.exists || client.data()?.status === 'archived' || model?.status === 'archived')
            throw new HttpsError('failed-precondition', 'Activa el cliente y el modelo antes de editar.');
        const removeIds = new Set(input.poseIdsToRemove || []);
        removed = (model?.poses || []).filter((pose) => removeIds.has(pose.id));
        const poses = [...(model?.poses || []).filter((pose) => !removeIds.has(pose.id)), ...nextPoses];
        if (!poses.length)
            throw new HttpsError('invalid-argument', 'Conserva al menos una pose.');
        const now = FieldValue.serverTimestamp();
        tx.set(ref, { name, clientId: input.clientId, clientNameSnapshot: client.data()!.name, identityTraits: input.identityTraits === undefined ? model?.identityTraits ?? null : input.identityTraits,
            storageRootPath: model?.storageRootPath || `models/${input.clientId}/${ref.id}`, poses, poseCount: poses.length,
            coverPoseId: poses[0].id, coverPosePath: poses[0].storagePath, updatedAt: now,
            ...(getManglarContext()?.budgetId ? { manglarBudgetId: getManglarContext()!.budgetId } : {}),
            ...(!model ? { status: 'active', archivedAt: null, archivedByUid: null, generatedPhotoCount: Math.max(0, input.generatedPhotoCount || 0), generatedPhotoCostUsd: Math.max(0, input.generatedPhotoCostUsd || 0), createdByUid: uid, createdAt: now } : {}) }, { merge: true });
    });
    // Only delete assets removed from this model, using the same cleanup convention as the UI.
    await Promise.allSettled(removed.flatMap((pose) => [pose.storagePath, pose.previewStoragePath].filter((p): p is string => Boolean(p))).map((path) => admin.storage().bucket().file(path).delete()));
    return { id: ref.id };
};
export const replaceModelPoseService = async (input: ManglarPoseReplaceRequest, uid: string) => {
    await assertUserRoles(uid, undefined, ['admin']);
    const db = getAppFirestore();
    const ref = db.collection('models').doc(validId(input.modelId));
    const snapshot = await ref.get();
    const model = snapshot.data() as Model | undefined;
    const original = model?.poses.find((pose) => pose.id === input.poseId);
    if (!model || !original || model.status === 'archived')
        throw new HttpsError('not-found', 'Pose no disponible.');
    if (!input.storagePath.startsWith(`model_generations/${model.clientId}/`))
        throw new HttpsError('permission-denied', 'Usa una fotografía generada para este cliente.');
    const newPath = `${model.storageRootPath || `models/${model.clientId}/${input.modelId}`}/poses/${randomUUID()}-${original.fileName}`;
    await admin.storage().bucket().file(input.storagePath).copy(admin.storage().bucket().file(newPath));
    await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data() as Model;
        if (!current.poses.some((pose) => pose.id === input.poseId))
            throw new HttpsError('aborted', 'La pose cambió.');
        const poses = current.poses.map((pose) => pose.id === input.poseId ? { ...pose, storagePath: newPath, previewStoragePath: null, aiClassification: input.aiClassification || pose.aiClassification || null } : pose);
        tx.update(ref, { poses, coverPosePath: current.coverPoseId === input.poseId ? newPath : current.coverPosePath || poses[0].storagePath,
            generatedPhotoCount: FieldValue.increment(1), generatedPhotoCostUsd: FieldValue.increment(Math.max(0, input.estimatedCostUsd || 0)), updatedAt: FieldValue.serverTimestamp() });
    });
    await Promise.allSettled([original.storagePath, original.previewStoragePath, input.storagePath].filter((path): path is string => Boolean(path)).map((path) => admin.storage().bucket().file(path).delete()));
    return { modelId: input.modelId, poseId: input.poseId, storagePath: newPath };
};
export const flagJobService = async (input: ManglarJobFlagRequest, uid: string) => {
    await assertUserRoles(uid, undefined, ['admin', 'operador', 'revisor']);
    if (typeof input.flagged !== 'boolean')
        throw new HttpsError('invalid-argument', 'Marca inválida.');
    await getAppFirestore().collection('jobs').doc(validId(input.jobId)).update({ manuallyFlagged: input.flagged,
        manuallyFlaggedAt: input.flagged ? FieldValue.serverTimestamp() : null, manuallyFlaggedByUid: input.flagged ? uid : null, updatedAt: FieldValue.serverTimestamp() });
    return { jobId: input.jobId, flagged: input.flagged };
};
export const saveClient = onCall<ManglarClientSaveRequest>(async (request) => { await assertCallableRoles(request, ['admin']); return saveClientService(request.data, request.auth!.uid); });
export const saveModel = onCall<ManglarModelSaveRequest>(async (request) => { await assertCallableRoles(request, ['admin']); return saveModelService(request.data, request.auth!.uid); });
export const setClientArchived = onCall<ManglarEntityStateRequest & {
    archived: boolean;
}>(async (request) => { await assertCallableRoles(request, ['admin']); return setCatalogArchivedService('clients', request.data, request.auth!.uid, request.data.archived); });
export const setModelArchived = onCall<ManglarEntityStateRequest & {
    archived: boolean;
}>(async (request) => { await assertCallableRoles(request, ['admin']); return setCatalogArchivedService('models', request.data, request.auth!.uid, request.data.archived); });
export const replaceModelPose = onCall<ManglarPoseReplaceRequest>(async (request) => { await assertCallableRoles(request, ['admin']); return replaceModelPoseService(request.data, request.auth!.uid); });
export const setJobManualFlag = onCall<ManglarJobFlagRequest>(async (request) => { await assertCallableRoles(request, ['admin', 'operador', 'revisor']); return flagJobService(request.data, request.auth!.uid); });
