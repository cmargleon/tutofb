import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { ModelMarketplaceRules, SaveModelMarketplaceRuleRequest, SaveModelMarketplaceRuleResponse } from '../../../../shared/src/types';
import { db, functions } from '../../../firebase';

export const subscribeModelMarketplaceRules = (next: (rules: ModelMarketplaceRules) => void, error: (error: Error) => void) =>
  onSnapshot(doc(db, 'system_config', 'model_marketplace_rules'), snapshot => next(snapshot.data()?.marketplaces ?? {}), error);
export const saveModelMarketplaceRule = async (data: SaveModelMarketplaceRuleRequest) =>
  (await httpsCallable<SaveModelMarketplaceRuleRequest, SaveModelMarketplaceRuleResponse>(functions, 'saveModelMarketplaceRule')(data)).data;
