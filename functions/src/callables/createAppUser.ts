import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertCallableRoles } from '../auth/roles';
import {
  applyUserClaims,
  buildUserResponse,
  sanitizeCreateUserInput,
  upsertUserDoc,
} from './userManagement.helpers';

export const createAppUser = onCall(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const input = sanitizeCreateUserInput(request.data);
  let createdUid: string | null = null;

  try {
    const authUser = await admin.auth().createUser({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      disabled: !input.active,
    });

    createdUid = authUser.uid;

    await upsertUserDoc({
      uid: authUser.uid,
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      active: input.active,
      existingUser: null,
    });

    await applyUserClaims(authUser.uid, {
      role: input.role,
      active: input.active,
    });

    return {
      success: true,
      user: await buildUserResponse(authUser.uid),
    };
  } catch (error: any) {
    if (createdUid) {
      await admin.auth().deleteUser(createdUid).catch(() => undefined);
    }

    if (error instanceof HttpsError) {
      throw error;
    }

    const message = typeof error?.message === 'string' ? error.message : 'No se pudo crear el usuario.';
    throw new HttpsError('internal', message);
  }
});
