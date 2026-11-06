import type { ClientAutomationConfig } from './types';

export type ClientAutomationSection = 'sources' | 'automation';

/** Compare only the fields edited by one tab. Missing folders mean an empty list. */
export const selectClientAutomationSection = (config: ClientAutomationConfig | null | undefined, section: ClientAutomationSection) => {
  const { driveFolderIds, ...automation } = config ?? {};
  return section === 'sources' ? { driveFolderIds: driveFolderIds ?? [] } : automation;
};

/** Apply a saved/discarded tab without clearing the other tab's pending changes. */
export const mergeClientAutomationSection = (current: ClientAutomationConfig | null, saved: ClientAutomationConfig | null, section: ClientAutomationSection): ClientAutomationConfig => {
  if (section === 'sources') return { ...current, driveFolderIds: saved?.driveFolderIds ?? [] };
  const { driveFolderIds: _folders, ...automation } = saved ?? {};
  return { ...automation, ...(current?.driveFolderIds === undefined ? {} : { driveFolderIds: current.driveFolderIds }) };
};
