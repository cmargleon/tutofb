import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const syncUserClaims = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in');
  }

  const { uid, role } = request.data;
  
  if (!uid || !role) {
    throw new HttpsError('invalid-argument', 'Missing required fields');
  }

  // Check if caller is admin
  const callerRecord = await admin.auth().getUser(request.auth.uid);
  if (callerRecord.customClaims?.role !== 'admin' && request.auth.token.email !== 'claudiomatiasrg@gmail.com') {
    throw new HttpsError('permission-denied', 'Only admins can sync claims');
  }

  // Set custom claim
  await admin.auth().setCustomUserClaims(uid, { role });

  // Update user document
  const db = admin.firestore();
  await db.collection('users').doc(uid).update({
    role,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true };
});
