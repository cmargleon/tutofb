import { resolveAutomationRules, resolveEffectiveAutomationConfig, validateAutomationRules } from '../../../shared/src/automationConfig';
import { useSystemConfig } from '../system/useSystemConfig';
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

const MAX_DRIVE_FOLDERS = 20;
const driveFolderIdFromUrl = (url: string) =>
  /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]{1,200})\/?(?:[?#][^\s]*)?$/.exec(url)?.[1];

// Older configurations may contain multiple entries in one textarea line.
const readDriveFolders = (entries: string[] = []) =>
  entries.flatMap(entry => entry.split(/[\n,]+/)).map(entry => entry.trim()).filter(Boolean);

export const useClientAutomationConfig = (client: Client) => {
  const draft = useClientDraft<ClientAutomationConfig | null>(`${client.id}:automation`, client.automation ?? null, isAutomationDraft);
  const value: ClientAutomationConfig = { ...draft.value, enabled: draft.value?.enabled ?? true };
  const setValue = (next: ClientAutomationConfig | ((current: ClientAutomationConfig) => ClientAutomationConfig)) => draft.setValue(current => typeof next === 'function' ? next({ ...current, enabled: current?.enabled ?? true }) : next);
  const folders = [...new Set(readDriveFolders(draft.base?.driveFolderIds).map(entry => driveFolderIdFromUrl(entry) ?? entry))];
  const savedFolders = configSnapshot(client.automation?.driveFolderIds ?? []);
  useEffect(() => {
    // Folder edits now persist immediately. Rebase old session drafts on the live folder list.
    const source = selectClientAutomationSection(client.automation, 'sources');
    if (configSnapshot(draft.value?.driveFolderIds ?? []) === savedFolders
      && configSnapshot(draft.base?.driveFolderIds ?? []) === savedFolders) return;
    draft.markSavedPartial(current => mergeClientAutomationSection(current, source, 'sources'));
  }, [savedFolders]);
  const [models, setModels] = useState<Model[]>([]);
  const [presetName, setPresetName] = useState('');
  const [savingSection, setSavingSection] = useState<ClientAutomationSection | null>(null);
  const saving = savingSection !== null;
  const toast = useToast();
  useEffect(() => { setPresetName(client.automation?.defaultPreset || ''); }, [client.id]);
  useEffect(() => subscribeToModels(setModels, (error) => toast({ tone: 'error', title: 'No se pudieron cargar los modelos', description: error.message }), { clientId: client.id }), [client.id]);
  const { config: systemConfig, loading: systemLoading } = useSystemConfig();
  const preset = value.presets?.[presetName] || {};
  const availableModels = models.filter(model => model.clientId === client.id && model.active !== false && model.status !== 'archived');
  const genderDefaults = getClientGenderModelDefaults(client.id!, value, availableModels);
  const inheritedRules = resolveAutomationRules(systemConfig.automationRules);
  const effectiveConfig = resolveEffectiveAutomationConfig({ system: systemConfig, client: { ...client, automation: value }, models: availableModels });
  const setRule = (key: keyof NonNullable<ClientAutomationConfig['rules']>, input: string) => setValue(current => {
    const rules = { ...current.rules };
    if (input === '') delete rules[key]; else rules[key] = Number(input);
    const next = { ...current };
    if (Object.keys(rules).length) next.rules = rules; else delete next.rules;
    return next;
  });
  const updatePreset = (patch: Partial<AutomationPreset>) => setValue((current) => {
    const next = { ...current.presets?.[presetName], ...patch };
    if (patch.prompt === '') delete next.prompt;
    return { ...current, presets: { ...current.presets, [presetName]: next } };
  });
  const isDirty = (section: ClientAutomationSection) => configSnapshot(selectClientAutomationSection(draft.value, section)) !== configSnapshot(selectClientAutomationSection(draft.base, section));
  const applySection = (saved: ClientAutomationConfig | null, section: ClientAutomationSection) => {
    const other = section === 'sources' ? 'automation' : 'sources';
    const preserveOther = other === 'automation' && isDirty(other);
    draft.markSavedPartial(current => {
      const next = mergeClientAutomationSection(current, saved, section);
      return preserveOther ? next : mergeClientAutomationSection(next, saved, other);
    });
  };
  const discardSection = (section: ClientAutomationSection) => applySection(client.automation ?? null, section);
  const save = async (section: ClientAutomationSection, automation: ClientAutomationConfig) => {
    if (saving || client.status === 'archived') return false;
    setSavingSection(section);
    try {
      if (section === 'automation') validateAutomationRules(value.rules ?? {});
      const result = await updateClientAutomation({ clientId: client.id!, section, expectedAutomation: draft.base, automation });
      applySection(result.automation, section);
      toast({ tone: 'success', title: section === 'sources' ? 'Fuentes de datos guardadas' : 'Automatizaciones guardadas' });
      return true;
    } catch (error) {
      toast({ tone: 'error', title: 'No se pudo guardar', description: (error as Error).message });
      return false;
    }
    finally { setSavingSection(null); }
  };
  const addFolder = async (url: string) => {
    const folderId = driveFolderIdFromUrl(url.trim());
    if (!folderId) return { error: 'Pega el enlace completo de una carpeta de Google Drive.' };
    if (folders.includes(folderId)) return { error: 'Esta carpeta ya está en la lista.' };
    if (folders.length >= MAX_DRIVE_FOLDERS) return { error: 'Puedes agregar hasta 20 carpetas por cliente.' };
    return { saved: await save('sources', { driveFolderIds: [...folders, folderId] }) };
  };
  const removeFolder = (folderId: string) => save('sources', { driveFolderIds: folders.filter(id => id !== folderId) });
  return { effectiveConfig, inheritedRules, setRule, systemConfig, systemLoading, isDirty, discardSection, value, setValue, folders, addFolder, removeFolder, presetName, setPresetName, preset, updatePreset, models: availableModels,
    genderDefaults, maleModels: availableModels.filter(model => getModelGender(model) !== 'female'),
    femaleModels: availableModels.filter(model => getModelGender(model) !== 'male'), saving, savingSection, saveAutomation: () => save('automation', { ...selectClientAutomationSection(value, 'automation'), ...genderDefaults }) };
};
