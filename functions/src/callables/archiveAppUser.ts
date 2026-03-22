import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ArchiveAppUserRequest, ArchiveAppUserResponse } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { assertCallableRoles } from '../auth/roles';
import { applyUserClaims, loadUserDoc } from './userManagement.helpers';

export const archiveAppUser = onCall<ArchiveAppUserRequest, Promise<ArchiveAppUserResponse>>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
  }

  const uid = typeof request.data?.uid === 'string' ? request.data.uid.trim() : '';
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Debes indicar el usuario a archivar.');
  }

  if (request.auth.uid === uid) {
    throw new HttpsError('permission-denied', 'No puedes archivar tu propia cuenta desde este panel.');
  }

  const existingUser = await loadUserDoc(uid);
  if (!existingUser) {
    throw new HttpsError('not-found', 'No se encontró el usuario seleccionado.');
  }

  if (isArchivedCatalogEntity(existingUser)) {
    return { success: true, uid };
  }

  await admin.firestore().collection('users').doc(uid).set(
    {
      active: false,
      status: 'archived',
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      archivedByUid: request.auth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await admin.auth().updateUser(uid, {
    disabled: true,
  });

  await applyUserClaims(uid, {
    role: existingUser.role,
    active: false,
  });

  return { success: true, uid };
});
