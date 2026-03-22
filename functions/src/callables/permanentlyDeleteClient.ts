import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PermanentDeleteCatalogEntityRequest, PermanentDeleteCatalogEntityResponse, Client } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

export const permanentlyDeleteClient = onCall<
  PermanentDeleteCatalogEntityRequest,
  Promise<PermanentDeleteCatalogEntityResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const id = typeof request.data?.id === 'string' ? request.data.id.trim() : '';
  if (!id) {
    throw new HttpsError('invalid-argument', 'Debes indicar el cliente a borrar.');
  }

  const db = getAppFirestore();
  const clientRef = db.collection('clients').doc(id);
  const clientSnapshot = await clientRef.get();

  if (!clientSnapshot.exists) {
    throw new HttpsError('not-found', 'No se encontró el cliente seleccionado.');
  }

  const client = clientSnapshot.data() as Client;
  if (!isArchivedCatalogEntity(client)) {
    throw new HttpsError('failed-precondition', 'Primero archiva el cliente antes de borrarlo definitivamente.');
  }

  await clientRef.delete();

  return {
    success: true,
    id,
  };
});
