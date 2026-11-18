import { isSpreadsheetTemplateActive } from '../../../../shared/src/types';
import { FirebaseError } from 'firebase/app';
import { getDownloadURL, getMetadata, ref } from 'firebase/storage';
import { isActiveCatalogEntity, isPoseActive } from '../../../../shared/src/domain';
import type { Client, Model, SpreadsheetTemplate, SpreadsheetTemplateCategory } from '../../../../shared/src/types';
import { auth, storage } from '../../../firebase';
import { useAuth } from '../../auth/AuthProvider';
import {
  subscribeToClientSpreadsheetTemplates,
  subscribeToClients,
  subscribeToSpreadsheetTemplateCategories,
} from '../../clients/firebase';
import { subscribeToModels } from '../../models/firebase';
import { StoragePathStatus, WizardDraft, WizardDraftCatalog, collectWizardDraftPaths } from './draft';

/** Firebase side of wizard drafts, kept apart so browser tests can replace it. */
export const useWizardDraftIdentity = () => {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  return uid ? { uid, project: auth.app.options.projectId!, isCurrent: () => auth.currentUser?.uid === uid } : null;
};

/** Resolves with the first value a Firestore subscription delivers, then unsubscribes. */
const firstValue = <T,>(subscribe: (next: (value: T) => void, fail: (error: Error) => void) => () => void): Promise<T> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      settled = true;
      // The callback can run before subscribe() returns, so release on the next tick.
      setTimeout(() => unsubscribe?.(), 0);
    };
    unsubscribe = subscribe(
      (value) => { if (!settled) { finish(); resolve(value); } },
      (error) => { if (!settled) { finish(); reject(error); } },
    );
  });

const checkStoragePath = async (path: string, needsUrl: boolean): Promise<{ status: StoragePathStatus; url?: string }> => {
  try {
    if (needsUrl) return { status: 'ok', url: await getDownloadURL(ref(storage, path)) };
    await getMetadata(ref(storage, path));
    return { status: 'ok' };
  } catch (error) {
    return { status: error instanceof FirebaseError && error.code === 'storage/object-not-found' ? 'missing' : 'error' };
  }
};

export const loadDraftCatalog = async (draft: WizardDraft): Promise<WizardDraftCatalog> => {
  const { selectedClientId, selectedSpreadsheetTemplateId, outputMode } = draft.state;
  const { images, files } = collectWizardDraftPaths(draft);
  const [clients, models, templates, categories, imageChecks, fileChecks] = await Promise.all([
    firstValue<Client[]>((next, fail) => subscribeToClients(next, fail)),
    selectedClientId
      ? firstValue<Model[]>((next, fail) => subscribeToModels(next, fail, { clientId: selectedClientId }))
      : Promise.resolve([] as Model[]),
    selectedClientId && outputMode === 'spreadsheet'
      ? firstValue<SpreadsheetTemplate[]>((next, fail) => subscribeToClientSpreadsheetTemplates(selectedClientId, next, fail))
      : Promise.resolve(null),
    selectedClientId && outputMode === 'spreadsheet' && selectedSpreadsheetTemplateId
      ? firstValue<SpreadsheetTemplateCategory[]>((next, fail) =>
        subscribeToSpreadsheetTemplateCategories(selectedClientId, selectedSpreadsheetTemplateId, next, fail))
      : Promise.resolve(null),
    Promise.all(images.map(async (path) => [path, await checkStoragePath(path, true)] as const)),
    Promise.all(files.map(async (path) => [path, await checkStoragePath(path, false)] as const)),
  ]);
  return {
    // Same filters the wizard catalog applies, so restore never accepts what the UI hides.
    clients: clients.filter(isActiveCatalogEntity),
    models: models
      .filter((model) => model.clientId === selectedClientId && isActiveCatalogEntity(model))
      .map((model) => ({ ...model, poses: model.poses.filter(isPoseActive) })),
    templates: templates?.filter((template) => isSpreadsheetTemplateActive(template) && !template.exportConfig) ?? null,
    categories,
    paths: new Map([...imageChecks, ...fileChecks]),
  };
};

