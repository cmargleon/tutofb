import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { Model, SetModelActiveRequest, SetModelActiveResponse } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

export const setModelActive = onCall<SetModelActiveRequest, Promise<SetModelActiveResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin']);

    const { modelId, active } = request.data || {};
    if (typeof modelId !== 'string' || !/^[\w-]{1,200}$/.test(modelId)
      || typeof active !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Indica un modelo y un estado válidos.');
    }

    const db = getAppFirestore();
    const modelRef = db.collection('models').doc(modelId);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(modelRef);
      if (!snapshot.exists) throw new HttpsError('not-found', 'No se encontró el modelo.');
      const model = snapshot.data() as Model;
      if (isArchivedCatalogEntity(model)) {
        throw new HttpsError('failed-precondition', 'Reactiva el modelo antes de cambiar su disponibilidad.');
      }
      tx.update(modelRef, {
        active,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true, modelId, active };
  },
);
