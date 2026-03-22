import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PermanentDeleteCatalogEntityRequest, PermanentDeleteCatalogEntityResponse, Model } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

export const permanentlyDeleteModel = onCall<
  PermanentDeleteCatalogEntityRequest,
  Promise<PermanentDeleteCatalogEntityResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const id = typeof request.data?.id === 'string' ? request.data.id.trim() : '';
  if (!id) {
    throw new HttpsError('invalid-argument', 'Debes indicar el modelo a borrar.');
  }

  const db = getAppFirestore();
  const modelRef = db.collection('models').doc(id);
  const modelSnapshot = await modelRef.get();

  if (!modelSnapshot.exists) {
    throw new HttpsError('not-found', 'No se encontró el modelo seleccionado.');
  }

  const model = modelSnapshot.data() as Model;
  if (!isArchivedCatalogEntity(model)) {
    throw new HttpsError('failed-precondition', 'Primero archiva el modelo antes de borrarlo definitivamente.');
  }

  await modelRef.delete();

  return {
    success: true,
    id,
  };
});
