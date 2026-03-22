import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PermanentDeleteAppUserRequest, PermanentDeleteAppUserResponse } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { assertCallableRoles } from '../auth/roles';
import { loadUserDoc } from './userManagement.helpers';

export const permanentlyDeleteAppUser = onCall<
  PermanentDeleteAppUserRequest,
  Promise<PermanentDeleteAppUserResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
  }

  const uid = typeof request.data?.uid === 'string' ? request.data.uid.trim() : '';
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Debes indicar el usuario a borrar.');
  }

  if (request.auth.uid === uid) {
    throw new HttpsError('permission-denied', 'No puedes borrar tu propia cuenta desde este panel.');
  }

  const existingUser = await loadUserDoc(uid);
  if (!existingUser) {
    throw new HttpsError('not-found', 'No se encontró el usuario seleccionado.');
  }

  if (!isArchivedCatalogEntity(existingUser)) {
    throw new HttpsError('failed-precondition', 'Primero archiva el usuario antes de borrarlo definitivamente.');
  }

  try {
    await admin.auth().deleteUser(uid);
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'El usuario ya no existe en Firebase Auth.');
    }

    throw new HttpsError('internal', 'No se pudo borrar el usuario en Firebase Auth.');
  }

  await admin.firestore().collection('users').doc(uid).delete();

  return {
    success: true,
    uid,
  };
});
