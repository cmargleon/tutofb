import { isAutomationDraft } from '../clients/draftStorage';
import { useEffect, useState } from 'react';
import type { AutomationPreset, Client, ClientAutomationConfig, Model } from '../../../shared/src/types';
import { getClientGenderModelDefaults, getModelGender } from '../../../shared/src/automationModels';
import { useToast } from '../feedback/FeedbackProvider';
import { subscribeToModels } from '../models/firebase';
import { updateClientAutomation } from '../clients/firebase';
import { useClientDraft } from '../clients/useClientDraft';
import { configSnapshot } from '../../../shared/src/configSnapshot';
import { mergeClientAutomationSection, selectClientAutomationSection, type ClientAutomationSection } from '../../../shared/src/clientAutomationSections';

export const useClientAutomationConfig = (client: Client) => {
  const draft = useClientDraft<ClientAutomationConfig | null>(`${client.id}:automation`, client.automation ?? null, isAutomationDraft);
  const value: ClientAutomationConfig = { ...draft.value, enabled: draft.value?.enabled ?? true };
  const setValue = (next: ClientAutomationConfig | ((current: ClientAutomationConfig) => ClientAutomationConfig)) => draft.setValue(current => typeof next === 'function' ? next({ ...current, enabled: current?.enabled ?? true }) : next);
  const folders = (value.driveFolderIds || []).join('\n');
  const setFolders = (text: string) => draft.setValue(current => ({ ...current, driveFolderIds: text.split('\n') }));
  const [models, setModels] = useState<Model[]>([]);
  const [presetName, setPresetName] = useState('');
  const [savingSection, setSavingSection] = useState<ClientAutomationSection | null>(null);
  const saving = savingSection !== null;
  const toast = useToast();
  useEffect(() => { setPresetName(client.automation?.defaultPreset || ''); }, [client.id]);
  useEffect(() => subscribeToModels(setModels, (error) => toast({ tone: 'error', title: 'No se pudieron cargar los modelos', description: error.message }), { clientId: client.id }), [client.id]);
  const preset = value.presets?.[presetName] || {};
  const availableModels = models.filter(model => model.clientId === client.id && model.active !== false && model.status !== 'archived');
  const genderDefaults = getClientGenderModelDefaults(client.id!, value, availableModels);
  const updatePreset = (patch: Partial<AutomationPreset>) => setValue((current) => {
    const next = { ...current.presets?.[presetName], ...patch };
    if (patch.prompt === '') delete next.prompt;
    return { ...current, presets: { ...current.presets, [presetName]: next } };
  });
  const isDirty = (section: ClientAutomationSection) => configSnapshot(selectClientAutomationSection(draft.value, section)) !== configSnapshot(selectClientAutomationSection(draft.base, section));
  const applySection = (saved: ClientAutomationConfig | null, section: ClientAutomationSection) => {
    const other = section === 'sources' ? 'automation' : 'sources';
    const preserveOther = isDirty(other);
    draft.markSavedPartial(current => {
      const next = mergeClientAutomationSection(current, saved, section);
      return preserveOther ? next : mergeClientAutomationSection(next, saved, other);
    });
  };
  const discardSection = (section: ClientAutomationSection) => applySection(client.automation ?? null, section);
  const save = async (section: ClientAutomationSection) => {
    setSavingSection(section);
    try {
      const automation = section === 'sources'
        ? { driveFolderIds: folders.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean) }
        : { ...selectClientAutomationSection(value, 'automation'), ...genderDefaults };
      const result = await updateClientAutomation({ clientId: client.id!, section, expectedAutomation: draft.base, automation });
      applySection(result.automation, section);
      toast({ tone: 'success', title: section === 'sources' ? 'Fuentes de datos guardadas' : 'Automatizaciones guardadas' });
    } catch (error) { toast({ tone: 'error', title: 'No se pudo guardar', description: (error as Error).message }); }
    finally { setSavingSection(null); }
  };
  return { isDirty, discardSection, value, setValue, folders, setFolders, presetName, setPresetName, preset, updatePreset, models: availableModels,
    genderDefaults, maleModels: availableModels.filter(model => getModelGender(model) !== 'female'),
    femaleModels: availableModels.filter(model => getModelGender(model) !== 'male'), saving, savingSection, save };
};
