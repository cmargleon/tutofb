import { useEffect, useState } from 'react';
import type { AutomationPreset, Client, ClientAutomationConfig, Model } from '../../../shared/src/types';
import { getClientGenderModelDefaults, getModelGender } from '../../../shared/src/automationModels';
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
  const availableModels = models.filter(model => model.clientId === client.id && model.active !== false && model.status !== 'archived');
  const genderDefaults = getClientGenderModelDefaults(client.id!, value, availableModels);
  const updatePreset = (patch: Partial<AutomationPreset>) => setValue((current) => {
    const next = { ...current.presets?.[presetName], ...patch };
    if (patch.prompt === '') delete next.prompt;
    return { ...current, presets: { ...current.presets, [presetName]: next } };
  });
  const save = async () => {
    setSaving(true);
    try {
      await updateClientAutomation({ clientId: client.id!, automation: { ...value, ...genderDefaults, driveFolderIds: folders.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean) } });
      toast({ tone: 'success', title: 'Configuración de Drive y automatización guardada' });
    } catch (error) { toast({ tone: 'error', title: 'No se pudo guardar', description: (error as Error).message }); }
    finally { setSaving(false); }
  };
  return { value, setValue, folders, setFolders, presetName, setPresetName, preset, updatePreset, models: availableModels,
    genderDefaults, maleModels: availableModels.filter(model => getModelGender(model) !== 'female'),
    femaleModels: availableModels.filter(model => getModelGender(model) !== 'male'), saving, save };
};
