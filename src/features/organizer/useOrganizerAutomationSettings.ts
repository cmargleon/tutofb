import { useState } from 'react';
import { useSystemConfig } from '../system/useSystemConfig';
import { updateSystemConfig } from '../system/firebase';
import { useToast } from '../feedback/FeedbackProvider';

type OrganizerSetting = 'organizerWatcherEnabled' | 'organizerAutoGenerationEnabled';

export const useOrganizerAutomationSettings = () => {
  const { config, loading } = useSystemConfig();
  const [saving, setSaving] = useState<OrganizerSetting | null>(null);
  const toast = useToast();

  const toggle = async (key: OrganizerSetting, next: boolean, label: string) => {
    setSaving(key);
    try {
      await updateSystemConfig({ [key]: next });
      toast({ tone: 'success', title: `${label} ${next ? 'activada' : 'desactivada'}` });
    } catch (error) {
      toast({ tone: 'error', title: 'No se pudo guardar', description: (error as Error).message });
    } finally {
      setSaving(null);
    }
  };

  return { config, loading, saving, toggle };
};
