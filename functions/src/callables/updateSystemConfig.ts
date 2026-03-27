import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { UpdateSystemConfigRequest, UpdateSystemConfigResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { getSystemConfigDocRef, invalidateSystemConfigCache, sanitizeSystemConfig } from '../admin/systemConfig';

export const updateSystemConfig = onCall<UpdateSystemConfigRequest, Promise<UpdateSystemConfigResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin']);
    const db = getAppFirestore();
    const userSnapshot = await db.collection('users').doc(request.auth!.uid).get();
    const updatedByDisplayName =
      userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data()!.displayName
        : null;

    // Read current, merge with input, sanitize
    const currentSnap = await getSystemConfigDocRef().get();
    const current = currentSnap.exists ? (currentSnap.data() as any) : {};
    const merged = { ...current, ...request.data };
    const config = sanitizeSystemConfig(merged);

    await getSystemConfigDocRef().set(
      {
        ...config,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: request.auth!.uid,
        updatedByDisplayName,
      },
      { merge: false },
    );

    invalidateSystemConfigCache();
    return { success: true, config };
  },
);
