import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { User } from '../../../shared/src/types';

export const syncClaimsOnUserWrite = onDocumentWritten('users/{uid}', async (event) => {
  const uid = event.params.uid;
  const after = event.data?.after;

  if (!after?.exists) {
    await admin.auth().setCustomUserClaims(uid, null);
    return;
  }

  const user = after.data() as User;
  await admin.auth().setCustomUserClaims(uid, {
    role: user.role,
    active: user.active,
  });
});
