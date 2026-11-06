import { useEffect, useState } from 'react';
import { DEFAULT_ORGANIZER_AUTO_GENERATION_ENABLED } from '../../../shared/src/types';
import { useSystemConfig } from '../system/useSystemConfig';
import { updateSystemConfig } from '../system/firebase';
import { useToast } from '../feedback/FeedbackProvider';

export const useOrganizerAutomationSettings = () => {
  const { config, loading } = useSystemConfig();
  const [enabled, setEnabled] = useState(DEFAULT_ORGANIZER_AUTO_GENERATION_ENABLED);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEffect(() => setEnabled(config.organizerAutoGenerationEnabled ?? DEFAULT_ORGANIZER_AUTO_GENERATION_ENABLED), [config.organizerAutoGenerationEnabled]);
  const toggle = async () => {
    const next = !enabled;
    setSaving(true);
    try {
      await updateSystemConfig({ organizerAutoGenerationEnabled: next });
      setEnabled(next);
      toast({ tone: 'success', title: next ? 'Generación después de organizar activada' : 'Generación después de organizar desactivada' });
    } catch (error) {
      toast({ tone: 'error', title: 'No se pudo guardar', description: (error as Error).message });
    } finally { setSaving(false); }
  };
  return { enabled, loading, saving, toggle };
};
