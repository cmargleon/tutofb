import * as admin from 'firebase-admin';
import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { Role, User } from '../../../shared/src/types';

const loadUserDoc = async (uid: string): Promise<User | null> => {
  const snapshot = await admin.firestore().collection('users').doc(uid).get();
  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data() as User;
};

export const getRequestRole = async (request: CallableRequest<unknown>): Promise<Role | null> => {
  if (!request.auth) {
    return null;
  }

  const tokenRole = request.auth.token.role;
  if (tokenRole === 'admin' || tokenRole === 'operador' || tokenRole === 'revisor') {
    return tokenRole;
  }

  const user = await loadUserDoc(request.auth.uid);
  if (!user || !user.active) {
    return null;
  }

  return user.role;
};

export const assertCallableRoles = async (
  request: CallableRequest<unknown>,
  allowedRoles: Role[],
): Promise<Role> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
  }

  const role = await getRequestRole(request);
  if (!role || !allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'No tienes permisos para ejecutar esta acción.');
  }

  return role;
};
