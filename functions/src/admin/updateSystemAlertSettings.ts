import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import {
  SystemAlertSettings,
  UpdateSystemAlertSettingsRequest,
  UpdateSystemAlertSettingsResponse,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { getSystemAlertSettingsDocRef, sanitizeSystemAlertSettings } from './systemAlerts';

export const updateSystemAlertSettings = onCall<
  UpdateSystemAlertSettingsRequest,
  Promise<UpdateSystemAlertSettingsResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const db = getAppFirestore();
  const userSnapshot = await db.collection('users').doc(request.auth!.uid).get();
  const updatedByDisplayName =
    userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
      ? userSnapshot.data()!.displayName
      : null;

  const settings: SystemAlertSettings = sanitizeSystemAlertSettings(request.data || {});
  await getSystemAlertSettingsDocRef().set(
    {
      ...settings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: request.auth!.uid,
      updatedByDisplayName,
    },
    { merge: true },
  );

  return {
    success: true,
    settings: {
      ...settings,
      updatedByUid: request.auth!.uid,
      updatedByDisplayName,
    },
  };
});
