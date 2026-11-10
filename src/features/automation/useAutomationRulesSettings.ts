import { useEffect, useState } from 'react';
import { validateAutomationRules } from '../../../shared/src/automationConfig';
import type { AutomationRules } from '../../../shared/src/types';
import { useSystemConfig } from '../system/useSystemConfig';
import { updateSystemConfig } from '../system/firebase';
import { useToast } from '../feedback/FeedbackProvider';

export const useAutomationRulesSettings = () => {
  const { config, loading } = useSystemConfig();
  const [value, setValue] = useState<Partial<AutomationRules>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEffect(() => setValue(config.automationRules ?? {}), [config.automationRules]);
  const setRule = (key: keyof AutomationRules, input: string) => setValue(current => {
    const next = { ...current };
    if (input === '') delete next[key]; else next[key] = Number(input);
    return next;
  });
  const save = async () => {
    setSaving(true);
    try {
      await updateSystemConfig({ automationRules: validateAutomationRules(value) });
      toast({ tone: 'success', title: 'Reglas de automatización guardadas' });
    } catch (error) {
      toast({ tone: 'error', title: 'No se pudo guardar', description: (error as Error).message });
    } finally { setSaving(false); }
  };
  return { value, setRule, loading, saving, save };
};
