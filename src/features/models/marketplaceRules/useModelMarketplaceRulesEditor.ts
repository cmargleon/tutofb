import { useRef, useState } from 'react';
import type { MarketplaceId } from '../../../../shared/src/marketplaces';
import type { ModelMarketplaceRule } from '../../../../shared/src/types';
import { defaultModelMarketplaceRule, validateModelMarketplaceRule } from '../../../../shared/src/modelMarketplaceRules';
import { useToast } from '../../feedback/FeedbackProvider';
import { saveModelMarketplaceRule } from './firebase';
import { useModelMarketplaceRules } from './useModelMarketplaceRules';

export function useModelMarketplaceRulesEditor() {
  const state = useModelMarketplaceRules();
  const [channel, setChannel] = useState<MarketplaceId>('amazon');
  const [drafts, setDrafts] = useState<Partial<Record<MarketplaceId, { value: ModelMarketplaceRule; revision: number }>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const running = useRef(false);
  const toast = useToast();
  const saved = state.rules[channel];
  const draft = drafts[channel];
  const { revision: _revision, ...storedValue } = saved ?? { ...defaultModelMarketplaceRule(channel), revision: 0 };
  const value = draft?.value ?? storedValue;
  const edit = (next: ModelMarketplaceRule) => setDrafts(current => ({ ...current, [channel]: { value: next, revision: current[channel]?.revision ?? saved?.revision ?? 0 } }));
  const discard = () => { setDrafts(current => { const next = { ...current }; delete next[channel]; return next; }); setSaveError(''); };
  const save = async () => {
    if (running.current || !draft) return;
    running.current = true; setSaving(true); setSaveError('');
    const target = channel;
    try {
      const rule = validateModelMarketplaceRule(draft.value);
      await saveModelMarketplaceRule({ marketplaceId: target, expectedRevision: draft.revision, rule });
      setDrafts(current => { const next = { ...current }; delete next[target]; return next; });
      toast({ tone: 'success', title: 'Reglas guardadas', description: 'Las nuevas generaciones y verificaciones utilizarán esta versión.' });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'No se pudieron guardar las reglas.';
      setSaveError(message); toast({ tone: 'error', title: 'No se pudieron guardar las reglas', description: message });
    } finally { running.current = false; setSaving(false); }
  };
  return { ...state, channel, setChannel: (next: MarketplaceId) => { setChannel(next); setSaveError(''); }, value, edit, discard, save, saving, saveError, dirty: !!draft, revision: saved?.revision ?? 0 };
}
