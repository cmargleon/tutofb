import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertCallableRoles } from '../auth/roles';
import {
  applyUserClaims,
  buildUserResponse,
  loadUserDoc,
  sanitizeUpdateUserInput,
  upsertUserDoc,
} from './userManagement.helpers';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';

export const updateAppUser = onCall(async (request) => {
  await assertCallableRoles(request, ['admin']);

  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
  }

  const input = sanitizeUpdateUserInput(request.data);
  const uid = input.uid;
  const existingUser = await loadUserDoc(uid);

  if (existingUser && isArchivedCatalogEntity(existingUser)) {
    throw new HttpsError('failed-precondition', 'El usuario está archivado. Restáuralo antes de editarlo.');
  }

  if (request.auth.uid === uid && (!input.active || input.role !== 'admin')) {
    throw new HttpsError(
      'permission-denied',
      'No puedes desactivar tu propia cuenta ni quitarte el rol admin desde este panel.',
    );
  }

  try {
    await admin.auth().getUser(uid);
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'El usuario no existe en Firebase Auth.');
    }

    throw new HttpsError('internal', 'No se pudo cargar el usuario solicitado.');
  }

  try {
    const authProfileUpdates: {
      email?: string;
      displayName?: string;
      password?: string;
    } = {
      email: input.email,
      displayName: input.displayName,
    };

    if (input.password) {
      authProfileUpdates.password = input.password;
    }

    await admin.auth().updateUser(uid, authProfileUpdates);

    await upsertUserDoc({
      uid,
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      active: input.active,
      existingUser,
    });

    await admin.auth().updateUser(uid, {
      disabled: !input.active,
    });

    await applyUserClaims(uid, {
      role: input.role,
      active: input.active,
    });

    return {
      success: true,
      user: await buildUserResponse(uid),
    };
  } catch (error: any) {
    if (error instanceof HttpsError) {
      throw error;
    }

    if (error?.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'El usuario ya no existe en Firebase Auth.');
    }

    const message = typeof error?.message === 'string' ? error.message : 'No se pudo actualizar el usuario.';
    throw new HttpsError('internal', message);
  }
});
