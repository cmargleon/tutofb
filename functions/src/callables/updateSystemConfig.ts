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
    if (request.data.organizerWatcherEnabled !== undefined && typeof request.data.organizerWatcherEnabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'La vigilancia del Organizador debe estar activada o desactivada.');
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

    const ref = getSystemConfigDocRef();
    const config = await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      const next = sanitizeSystemConfig({ ...current, ...request.data });
      tx.set(ref, {
        ...next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: request.auth!.uid,
        updatedByDisplayName,
      });
      return next;
    });

    invalidateSystemConfigCache();
    return { success: true, config };
  },
);
