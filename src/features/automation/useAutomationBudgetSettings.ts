import { useEffect, useState } from 'react';
import { DEFAULT_AUTOMATION_BUDGET, validateAutomationBudget } from '../../../shared/src/automationPolicy';
import { useSystemConfig } from '../system/useSystemConfig';
import { updateSystemConfig } from '../system/firebase';
import { useToast } from '../feedback/FeedbackProvider';

export const useAutomationBudgetSettings = () => {
  const { config, loading } = useSystemConfig();
  const [value, setValue] = useState(DEFAULT_AUTOMATION_BUDGET);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEffect(() => setValue(config.automationBudget || DEFAULT_AUTOMATION_BUDGET), [config.automationBudget]);
  const save = async () => {
    setSaving(true);
    try { await updateSystemConfig({ automationBudget: validateAutomationBudget(value) }); toast({ tone: 'success', title: 'Presupuesto de automatización guardado' }); }
    catch (error) { toast({ tone: 'error', title: 'No se pudo guardar', description: (error as Error).message }); }
    finally { setSaving(false); }
  };
  return { value, setValue, loading, saving, save };
};
