import { onCall } from 'firebase-functions/v2/https';
import { UpsertFinanceClientPricingRequest, UpsertFinanceClientPricingResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { normalizePricingRequest, upsertPricing } from '../finance/pricing';

export const upsertFinanceClientPricing = onCall<UpsertFinanceClientPricingRequest, Promise<UpsertFinanceClientPricingResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin']);
    const userSnapshot = await getAppFirestore().collection('users').doc(request.auth!.uid).get();
    const updatedByDisplayName = typeof userSnapshot.data()?.displayName === 'string'
      ? userSnapshot.data()!.displayName
      : null;
    const normalized = await normalizePricingRequest(request.data, request.auth!.uid, updatedByDisplayName);
    const pricing = await upsertPricing(normalized);
    return { success: true, pricing };
  },
);
