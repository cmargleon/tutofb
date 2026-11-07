import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { Role, User } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { getManglarContext } from '../manglar/context';
import { humanClientIds } from '../../../shared/src/clientAccess';
import { authorizeHumanInput } from './clientAccess';
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

// Claims identify the signed-in user, but never authorize privileged human actions.
// Keep the claim argument for existing HTTP callers; the current app user is authoritative.
export const getUserRole = async (uid: string, _tokenRole?: unknown): Promise<Role | null> => {
  const user = await loadUserDoc(uid);
  if (!user || user.active !== true || isArchivedCatalogEntity(user)
    || !['admin', 'operador', 'revisor'].includes(user.role)) {
    return null;
  }

  return user.role;
};

export const assertCallableRoles = async (
  request: CallableRequest<unknown>,
  allowedRoles: Role[],
  resources?: Record<string, string>,
): Promise<Role> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
  }

  const delegated = getManglarContext();
  if (delegated?.caller) {
    if (request.auth.uid !== delegated.caller.uid) throw new HttpsError('permission-denied', 'Identidad delegada incorrecta.');
    await delegated.authorize?.(request.data);
  }
  const user = await loadUserDoc(request.auth.uid);
  const role = user?.active === true && !isArchivedCatalogEntity(user) && ['admin', 'operador', 'revisor'].includes(user.role) ? user.role : null;
  if (!role || !allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'No tienes permisos para ejecutar esta acción.');
  }

  await authorizeHumanInput(request.auth.uid, request.data, humanClientIds(user!), resources);
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
