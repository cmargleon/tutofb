import { isProvider } from '../../../shared/src/domain';
const PREFIX = 'tuto:client-draft:';
export const clientDraftKey = (project: string, uid: string, section: string) =>
  `${PREFIX}v2:${encodeURIComponent(project)}:${encodeURIComponent(uid)}:${encodeURIComponent(section)}`;

export function clearClientDrafts(project: string, uid: string, storage?: Storage) {
  const prefix = clientDraftKey(project, uid, '');
  try {
    storage ??= sessionStorage;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(prefix) || key?.startsWith(PREFIX) && !key.startsWith(`${PREFIX}v2:`)) storage.removeItem(key);
    }
  } catch { /* A blocked browser store cannot expose another identity's drafts. */ }
}

export function readClientDraft<T>(key: string | null, remote: T, validate?: (value: unknown) => boolean): { value: T; base: T } {
  if (key) try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || 'null');
    const sameShape = (value: unknown): boolean => {
      if (remote === null) return value === null || typeof value === 'object';
      if (Array.isArray(remote)) return Array.isArray(value);
      if (typeof remote !== 'object') return typeof value === typeof remote;
      return !!value && !Array.isArray(value) && typeof value === 'object'
        && Object.entries(remote as object).every(([field, sample]) => sample == null
          || typeof (value as Record<string, unknown>)[field] === typeof sample);
    };
    if (parsed?.version === 2 && sameShape(parsed.value) && sameShape(parsed.base) && (!validate || validate(parsed.value) && validate(parsed.base))) return { value: parsed.value, base: parsed.base };
  } catch { /* Old or invalid drafts are ignored. */ }
  return { value: remote, base: remote };
}

const isPresetDraft = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (item == null) return true;
    if (key === 'poseIds') return Array.isArray(item) && item.every(id => typeof id === 'string');
    if (key === 'provider') return isProvider(item);
    if (['modelId', 'aspectRatio', 'prompt'].includes(key)) return typeof item === 'string';
    if (key === 'scenes') return Array.isArray(item) && item.every(scene => scene && typeof scene === 'object' && !Array.isArray(scene));
    if (key === 'imageConfig') return typeof item === 'object' && !Array.isArray(item) && Object.entries(item).every(([field, entry]) => {
      if (field === 'provider') return isProvider(entry);
      if (field === 'imageSize' && typeof entry === 'object') return entry && !Array.isArray(entry)
        && 'width' in entry && 'height' in entry && typeof entry.width === 'number' && typeof entry.height === 'number';
      return typeof entry === 'string' || typeof entry === 'number' || entry == null;
    });
    return true;
  });
};

/** Optional automation fields need their own shape check, even when the remote section is null. */
export function isAutomationDraft(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Object.entries(data).every(([key, item]) => {
    if (item === null || item === undefined) return true;
    if (key === 'driveFolderIds') return Array.isArray(item) && item.every(id => typeof id === 'string');
    if (key === 'enabled' || key === 'paused') return typeof item === 'boolean';
    if (['defaultBudgetUsd', 'maxBudgetUsd', 'maxReviewAttempts', 'maxOperationalRetries'].includes(key)) return typeof item === 'number' && Number.isFinite(item);
    if (key === 'rules') return typeof item === 'object' && !Array.isArray(item) && Object.entries(item).every(([field, entry]) =>
      ['garmentGenderMinConfidence', 'classificationMinConfidence'].includes(field) && typeof entry === 'number' && Number.isFinite(entry));
    if (key === 'organizerGeneration') return typeof item === 'object' && !Array.isArray(item) && Object.entries(item).every(([field, entry]) =>
      field === 'enabled' ? typeof entry === 'boolean' : field === 'preset' && typeof entry === 'string');
    if (key === 'presets') return typeof item === 'object' && !Array.isArray(item) && Object.values(item).every(isPresetDraft);
    if (['defaultPreset', 'defaultModelId', 'defaultMaleModelId', 'defaultFemaleModelId'].includes(key)) return typeof item === 'string';
    return true;
  });
}
