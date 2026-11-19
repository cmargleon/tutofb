import { useEffect, useState } from 'react';
import type { ModelMarketplaceRules } from '../../../../shared/src/types';
import { subscribeModelMarketplaceRules } from './firebase';

export function useModelMarketplaceRules() {
  const [rules, setRules] = useState<ModelMarketplaceRules>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => subscribeModelMarketplaceRules(value => { setRules(value); setLoading(false); setError(''); }, failure => {
    setError(failure.message); setLoading(false);
  }), []);
  return { rules, loading, error };
}
