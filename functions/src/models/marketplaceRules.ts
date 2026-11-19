import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { isMarketplaceId } from '../../../shared/src/marketplaces';
import { validateModelMarketplaceRule } from '../../../shared/src/modelMarketplaceRules';
import type { ModelMarketplaceRules, SaveModelMarketplaceRuleRequest, SaveModelMarketplaceRuleResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

export const modelMarketplaceRulesRef = () => getAppFirestore().doc('system_config/model_marketplace_rules');
export async function getModelMarketplaceRules(): Promise<ModelMarketplaceRules> {
  return (await modelMarketplaceRulesRef().get()).get('marketplaces') ?? {};
}
export async function saveModelMarketplaceRuleCore(input: SaveModelMarketplaceRuleRequest, uid: string): Promise<SaveModelMarketplaceRuleResponse> {
  if (!input || !isMarketplaceId(input.marketplaceId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
    throw new HttpsError('invalid-argument', 'Marketplace o revisión inválidos.');
  let validated;
  try { validated = validateModelMarketplaceRule(input.rule); }
  catch (error) { throw new HttpsError('invalid-argument', (error as Error).message); }
  const ref = modelMarketplaceRulesRef();
  return getAppFirestore().runTransaction(async tx => {
    const current = (await tx.get(ref)).get('marketplaces') as ModelMarketplaceRules | undefined;
    if ((current?.[input.marketplaceId]?.revision ?? 0) !== input.expectedRevision)
      throw new HttpsError('aborted', 'Otra persona modificó estas reglas. Recarga los valores guardados antes de continuar.');
    const rule = { ...validated, revision: input.expectedRevision + 1 };
    tx.set(ref, { marketplaces: { ...current, [input.marketplaceId]: rule }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedByUid: uid });
    return { rule };
  });
}
export const saveModelMarketplaceRule = onCall<SaveModelMarketplaceRuleRequest>(async request => {
  await assertCallableRoles(request, ['admin']);
  return saveModelMarketplaceRuleCore(request.data, request.auth!.uid);
});
