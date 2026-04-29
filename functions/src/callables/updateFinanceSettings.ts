import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { UpdateFinanceSettingsRequest, UpdateFinanceSettingsResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import {
  getFinanceSettingsDocRef,
  invalidateFinanceSettingsCache,
  sanitizeFinanceSettings,
} from '../finance/currency';

export const updateFinanceSettings = onCall<UpdateFinanceSettingsRequest, Promise<UpdateFinanceSettingsResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin']);
    const db = getAppFirestore();
    const userSnapshot = await db.collection('users').doc(request.auth!.uid).get();
    const updatedByDisplayName = typeof userSnapshot.data()?.displayName === 'string'
      ? userSnapshot.data()!.displayName
      : null;
    const currentSnapshot = await getFinanceSettingsDocRef().get();
    const settings = sanitizeFinanceSettings({
      ...(currentSnapshot.exists ? currentSnapshot.data() : {}),
      ...request.data,
    });

    await getFinanceSettingsDocRef().set({
      ...settings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: request.auth!.uid,
      updatedByDisplayName,
    }, { merge: false });
    invalidateFinanceSettingsCache();

    return { success: true, settings };
  },
);
