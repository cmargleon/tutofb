import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { Model, SetModelPoseActiveRequest, SetModelPoseActiveResponse } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

export const setModelPoseActive = onCall<SetModelPoseActiveRequest, Promise<SetModelPoseActiveResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin']);

    const { modelId, poseId, active } = request.data || {};
    if (typeof modelId !== 'string' || !/^[\w-]{1,200}$/.test(modelId)
      || typeof poseId !== 'string' || !/^[\w-]{1,200}$/.test(poseId)
      || typeof active !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Indica un modelo, una pose y un estado válidos.');
    }

    const db = getAppFirestore();
    const modelRef = db.collection('models').doc(modelId);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(modelRef);
      if (!snapshot.exists) throw new HttpsError('not-found', 'No se encontró el modelo.');
      const model = snapshot.data() as Model;
      if (isArchivedCatalogEntity(model)) {
        throw new HttpsError('failed-precondition', 'Reactiva el modelo antes de editar sus poses.');
      }
      if (!model.poses.some((pose) => pose.id === poseId)) {
        throw new HttpsError('not-found', 'La pose ya no pertenece al modelo.');
      }
      tx.update(modelRef, {
        poses: model.poses.map((pose) => pose.id === poseId ? { ...pose, active } : pose),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true, modelId, poseId, active };
  },
);
