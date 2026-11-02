import { useEffect, useState } from 'react';
import type { AutomationPreset, Client, ClientAutomationConfig, Model } from '../../../shared/src/types';
import { useToast } from '../feedback/FeedbackProvider';
import { subscribeToModels } from '../models/firebase';
import { updateClientAutomation } from '../clients/firebase';

export const useClientAutomationConfig = (client: Client) => {
  const [value, setValue] = useState<ClientAutomationConfig>({ enabled: true });
  const [folders, setFolders] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [presetName, setPresetName] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEffect(() => { setValue({ ...client.automation, enabled: client.automation?.enabled ?? true }); setFolders((client.automation?.driveFolderIds || []).join('\n')); setPresetName(client.automation?.defaultPreset || ''); }, [client.id, client.automation]);
  useEffect(() => subscribeToModels(setModels, (error) => toast({ tone: 'error', title: 'No se pudieron cargar los modelos', description: error.message })), []);
  const preset = value.presets?.[presetName] || {};
  const updatePreset = (patch: Partial<AutomationPreset>) => setValue((current) => {
    const next = { ...current.presets?.[presetName], ...patch };
    if (patch.prompt === '') delete next.prompt;
    return { ...current, presets: { ...current.presets, [presetName]: next } };
  });
  const save = async () => {
    setSaving(true);
    try {
      await updateClientAutomation({ clientId: client.id!, automation: { ...value, driveFolderIds: folders.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean) } });
      toast({ tone: 'success', title: 'Automatización del cliente guardada' });
    } catch (error) { toast({ tone: 'error', title: 'No se pudo guardar', description: (error as Error).message }); }
    finally { setSaving(false); }
  };
  return { value, setValue, folders, setFolders, presetName, setPresetName, preset, updatePreset, models: models.filter((m) => m.clientId === client.id), saving, save };
};
