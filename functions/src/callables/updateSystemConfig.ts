import { validateAutomationBudget } from '../../../shared/src/automationPolicy';
import { validateAutomationRules } from '../../../shared/src/automationConfig';
import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { UpdateSystemConfigRequest, UpdateSystemConfigResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertValidAdditionalSystemPrompts, getSystemConfigDocRef, invalidateSystemConfigCache, sanitizeSystemConfig } from '../admin/systemConfig';

export const updateSystemConfig = onCall<UpdateSystemConfigRequest, Promise<UpdateSystemConfigResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin']);
    if (request.data.organizerAutoGenerationEnabled !== undefined && typeof request.data.organizerAutoGenerationEnabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'El control de generación después de organizar debe ser activado o desactivado.');
    }
    assertValidAdditionalSystemPrompts(request.data);
    if (request.data.automationBudget) {
      try { validateAutomationBudget(request.data.automationBudget); }
      catch (error) { throw new HttpsError('invalid-argument', (error as Error).message); }
    }
    if (request.data.automationRules !== undefined) {
      try { validateAutomationRules(request.data.automationRules); }
      catch (error) { throw new HttpsError('invalid-argument', (error as Error).message); }
    }
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
