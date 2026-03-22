import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { RestoreAppUserRequest, RestoreAppUserResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { loadUserDoc, applyUserClaims } from './userManagement.helpers';

export const restoreAppUser = onCall<RestoreAppUserRequest, Promise<RestoreAppUserResponse>>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const uid = typeof request.data?.uid === 'string' ? request.data.uid.trim() : '';
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Debes indicar el usuario a restaurar.');
  }

  const existingUser = await loadUserDoc(uid);
  if (!existingUser) {
    throw new HttpsError('not-found', 'No se encontró el usuario seleccionado.');
  }

  await admin.firestore().collection('users').doc(uid).set(
    {
      active: false,
      status: 'active',
      archivedAt: null,
      archivedByUid: null,
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
