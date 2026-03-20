import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { User } from '../../../shared/src/types';
import { getRequestRole } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

interface SyncUserClaimsRequest {
  uid?: string;
  role?: string;
}

const loadUser = async (uid: string): Promise<User | null> => {
  const snapshot = await getAppFirestore().collection('users').doc(uid).get();
  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data() as User;
};

const applyClaimsFromUser = async (uid: string, user: User): Promise<void> => {
  await admin.auth().setCustomUserClaims(uid, {
    role: user.role,
    active: user.active,
  });
};

export const syncUserClaims = onCall<SyncUserClaimsRequest>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para sincronizar claims.');
  }

  const targetUid = typeof request.data?.uid === 'string' && request.data.uid.trim()
    ? request.data.uid.trim()
    : request.auth.uid;

  const callerRole = await getRequestRole(request);
  const callerIsAdmin = callerRole === 'admin';

  if (!callerIsAdmin && targetUid !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Solo un administrador puede sincronizar claims de otros usuarios.');
  }

  if (callerIsAdmin && request.data?.role && !['admin', 'operador', 'revisor'].includes(request.data.role)) {
    throw new HttpsError('invalid-argument', 'El rol solicitado no es válido.');
  }

  const targetUser = await loadUser(targetUid);
  if (!targetUser) {
    throw new HttpsError('not-found', 'No se encontró el documento del usuario.');
  }

  if (!targetUser.active) {
    await applyClaimsFromUser(targetUid, targetUser);
    return {
      success: true,
      uid: targetUid,
      role: targetUser.role,
      active: targetUser.active,
    };
  }

  if (callerIsAdmin && request.data?.role && request.data.role !== targetUser.role) {
    await getAppFirestore().collection('users').doc(targetUid).update({
      role: request.data.role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const refreshedUser = await loadUser(targetUid);
    if (!refreshedUser) {
      throw new HttpsError('internal', 'No se pudo recargar el usuario después de actualizar el rol.');
    }

    await applyClaimsFromUser(targetUid, refreshedUser);
    return {
      success: true,
      uid: targetUid,
      role: refreshedUser.role,
      active: refreshedUser.active,
    };
  }

  await applyClaimsFromUser(targetUid, targetUser);
  return {
    success: true,
    uid: targetUid,
    role: targetUser.role,
    active: targetUser.active,
  };
});
