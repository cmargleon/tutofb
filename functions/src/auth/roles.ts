import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { Role, User } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';

const loadUserDoc = async (uid: string): Promise<User | null> => {
  const snapshot = await getAppFirestore().collection('users').doc(uid).get();
  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data() as User;
};

export const getRequestRole = async (request: CallableRequest<unknown>): Promise<Role | null> => {
  if (!request.auth) {
    return null;
  }

  return getUserRole(request.auth.uid, request.auth.token.role);
};

export const getUserRole = async (uid: string, tokenRole?: unknown): Promise<Role | null> => {
  if (tokenRole === 'admin' || tokenRole === 'operador' || tokenRole === 'revisor') {
    return tokenRole;
  }

  const user = await loadUserDoc(uid);
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

export const assertUserRoles = async (
  uid: string | null | undefined,
  tokenRole: unknown,
  allowedRoles: Role[],
): Promise<Role> => {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
  }

  const role = await getUserRole(uid, tokenRole);
  if (!role || !allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'No tienes permisos para ejecutar esta acción.');
  }

  return role;
};
