import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import type { SetUserClientAccessRequest } from '../../../shared/src/types';
import { configSnapshot } from '../../../shared/src/configSnapshot';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';

export const setUserClientAccess = onCall<SetUserClientAccessRequest>(async request => {
  await assertCallableRoles(request, ['admin']);
  const input = request.data;
  const uid = validId(input?.uid);
  const access = input.clientAccess;
  if (!access || !['global', 'assigned'].includes(access.mode) || !Object.hasOwn(input, 'expected')
    || Object.keys(access).some(key => !['mode', 'clientIds'].includes(key))
    || access.mode === 'assigned' && (!Array.isArray(access.clientIds) || access.clientIds.length > 100))
    throw new HttpsError('invalid-argument', 'Alcance inválido.');
  const ids = access.mode === 'assigned' ? [...new Set(access.clientIds.map(validId))] : [];
  const db = getAppFirestore();
  await db.runTransaction(async tx => {
    const userRef = db.collection('users').doc(uid);
    const user = await tx.get(userRef);
    if (!user.exists) throw new HttpsError('not-found', 'Usuario no disponible.');
    if (user.data()!.role === 'admin') throw new HttpsError('failed-precondition', 'Los administradores mantienen acceso global.');
    if (configSnapshot(user.data()!.clientAccess ?? null) !== configSnapshot(input.expected)) throw new HttpsError('aborted', 'El alcance cambió. Recarga el usuario antes de guardar.');
    if (ids.length) {
      const clients = await tx.getAll(...ids.map(id => db.collection('clients').doc(id)));
      if (clients.some(doc => !doc.exists)) throw new HttpsError('invalid-argument', 'Un cliente no existe.');
    }
    tx.update(userRef, { clientAccess: access.mode === 'global' ? { mode: 'global' } : { mode: 'assigned', clientIds: ids }, updatedAt: FieldValue.serverTimestamp() });
  });
  return { success: true };
});
