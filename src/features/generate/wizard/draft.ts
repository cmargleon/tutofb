import { isProvider } from '../../../../shared/src/domain';
import { PRODUCT_SCENES } from '../../../../shared/src/productGeneration';
import type { Client, Model, SpreadsheetTemplate, SpreadsheetTemplateCategory } from '../../../../shared/src/types';
import {
  GarmentOriginalPhotoDraft,
  GarmentPhotoClassificationState,
  UploadedGarmentDraft,
  WizardState,
  createInitialGarmentUploadState,
  createInitialPoseSuggestionState,
  createInitialProductDraftPreparationState,
} from '../types';
import { GENERATE_WIZARD_MAX_STEP, isGarmentUploadedForBatch } from './state';

/**
 * Wizard drafts survive reloads and closed tabs, so they live in localStorage
 * keyed by project, user and wizard scope. Only ids, Storage paths and plain
 * settings are kept; File objects and blob URLs are rebuilt on restore.
 */
export const WIZARD_DRAFT_VERSION = 1;
/** 72 h covers an overnight or weekend pause without resurrecting stale work. */
export const WIZARD_DRAFT_TTL_MS = 72 * 60 * 60 * 1000;
const PREFIX = 'tuto:generate-draft:';

export const wizardDraftKey = (project: string, uid: string, scope: string) =>
  `${PREFIX}v${WIZARD_DRAFT_VERSION}:${encodeURIComponent(project)}:${encodeURIComponent(uid)}:${encodeURIComponent(scope)}`;

/** Removes every wizard draft of one identity (logout / account switch). */
export function clearWizardDrafts(project: string, uid: string, storage?: Storage) {
  const prefix = `${PREFIX}v${WIZARD_DRAFT_VERSION}:${encodeURIComponent(project)}:${encodeURIComponent(uid)}:`;
  try {
    storage ??= localStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch { /* A blocked store holds nothing to clear. */ }
}

export interface WizardDraftDirtyFlags {
  prompt: boolean;
  promptBlocks: boolean;
  productScenes: boolean;
}

export interface WizardDraftPhoto {
  id: string;
  fileName: string;
  sourceIndex: number;
  storagePath: string;
  classification: GarmentPhotoClassificationState;
}

export type WizardDraftGarment = Omit<UploadedGarmentDraft, 'files' | 'previewUrl' | 'originalPhotos' | 'upload'> & {
  storagePath: string;
  uploadAttempts: number;
  originalPhotos: WizardDraftPhoto[];
};

type PersistedStateFields = Pick<WizardState,
  | 'step' | 'generationKind' | 'selectedClientId' | 'selectedModelId' | 'outputMode' | 'outputModeChosen'
  | 'selectedSpreadsheetTemplateId' | 'selectedSpreadsheetCategoryId' | 'sourceSpreadsheetSummary'
  | 'selectedPoseIds' | 'poseSuggestions' | 'productDrafts' | 'productDraftPreparation' | 'productScenes'
  | 'provider' | 'providerImageConfigs' | 'prompt' | 'tryOnPromptBlocks'>;

export interface WizardDraft {
  version: typeof WIZARD_DRAFT_VERSION;
  savedAt: number;
  scope: string;
  draftBatchId: string | null;
  /** True while createXBatch was in flight: a reload then may already have created the batch. */
  submitting: boolean;
  dirty: WizardDraftDirtyFlags;
  state: PersistedStateFields & {
    sourceSpreadsheet: { originalFileName: string; storagePath: string } | null;
  };
  garments: WizardDraftGarment[];
  /** Items whose upload had not finished when the draft was saved. */
  incompleteGarmentNames: string[];
}

export const isGarmentDraftComplete = (garment: UploadedGarmentDraft, draftBatchId: string | null): boolean =>
  isGarmentUploadedForBatch(garment, draftBatchId)
  && garment.originalPhotos.length > 0
  && garment.originalPhotos.every((photo) => Boolean(photo.upload.storagePath));

const stableClassification = (classification: GarmentPhotoClassificationState): GarmentPhotoClassificationState =>
  classification.status === 'classifying' ? { ...classification, status: 'idle' } : classification;

const toDraftGarment = (garment: UploadedGarmentDraft): WizardDraftGarment => {
  const { files: _files, previewUrl: _previewUrl, originalPhotos, upload, ...rest } = garment;
  return {
    ...rest,
    analysisStatus: garment.analysisStatus === 'preparing' ? 'idle' : garment.analysisStatus,
    storagePath: upload.storagePath!,
    uploadAttempts: upload.attempts,
    originalPhotos: originalPhotos.map((photo) => ({
      id: photo.id,
      fileName: photo.fileName,
      sourceIndex: photo.sourceIndex,
      storagePath: photo.upload.storagePath!,
      classification: stableClassification(photo.classification),
    })),
  };
};

interface SerializeParams {
  state: WizardState;
  draftBatchId: string | null;
  dirty: WizardDraftDirtyFlags;
  scope: string;
  submitting: boolean;
  now: number;
}

/** Returns null when there is nothing worth restoring. */
export const serializeWizardDraft = ({ state, draftBatchId, dirty, scope, submitting, now }: SerializeParams): WizardDraft | null => {
  if (!state.selectedClientId && state.garments.length === 0) return null;
  const complete = state.garments.filter((garment) => isGarmentDraftComplete(garment, draftBatchId));
  const incomplete = state.garments.filter((garment) => !complete.includes(garment));
  const source = state.sourceSpreadsheet;
  return {
    version: WIZARD_DRAFT_VERSION,
    savedAt: now,
    scope,
    draftBatchId: complete.length ? draftBatchId : null,
    submitting,
    dirty,
    state: {
      step: state.step,
      generationKind: state.generationKind,
      selectedClientId: state.selectedClientId,
      selectedModelId: state.selectedModelId,
      outputMode: state.outputMode,
      outputModeChosen: state.outputModeChosen,
      selectedSpreadsheetTemplateId: state.selectedSpreadsheetTemplateId,
      selectedSpreadsheetCategoryId: state.selectedSpreadsheetCategoryId,
      sourceSpreadsheet: source?.status === 'uploaded' && source.storagePath
        ? { originalFileName: source.originalFileName, storagePath: source.storagePath }
        : null,
      // Results computed by Gemini are kept only once finished; anything in flight is redone.
      sourceSpreadsheetSummary: state.productDraftPreparation.status === 'ready' ? state.sourceSpreadsheetSummary : null,
      selectedPoseIds: state.selectedPoseIds,
      poseSuggestions: state.poseSuggestions.status === 'ready' ? state.poseSuggestions : createInitialPoseSuggestionState(),
      productDrafts: state.productDraftPreparation.status === 'ready' ? state.productDrafts : [],
      productDraftPreparation: state.productDraftPreparation.status === 'ready'
        ? state.productDraftPreparation
        : createInitialProductDraftPreparationState(),
      productScenes: state.productScenes,
      provider: state.provider,
      providerImageConfigs: state.providerImageConfigs,
      prompt: state.prompt,
      tryOnPromptBlocks: state.tryOnPromptBlocks,
    },
    garments: complete.map(toDraftGarment),
    incompleteGarmentNames: incomplete.map((garment) => garment.name),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isSafePathUnder = (path: unknown, prefix: string): path is string =>
  isString(path) && path.startsWith(prefix) && !path.split('/').some((part) => part === '..' || part === '.' || part === '');

const isDraftPhoto = (value: unknown, prefix: string): value is WizardDraftPhoto =>
  isRecord(value) && isString(value.id) && isString(value.fileName) && typeof value.sourceIndex === 'number'
  && isSafePathUnder(value.storagePath, prefix) && isRecord(value.classification) && isString(value.classification.status);

const isDraftGarment = (value: unknown, prefix: string): value is WizardDraftGarment =>
  isRecord(value) && isString(value.id) && isString(value.name) && isString(value.sourceType)
  && typeof value.isMultiAngle === 'boolean' && isStringArray(value.originalFileNames)
  && isSafePathUnder(value.storagePath, prefix)
  && Array.isArray(value.originalPhotos) && value.originalPhotos.length > 0
  && value.originalPhotos.every((photo) => isDraftPhoto(photo, prefix));

const isStep = (value: unknown): value is WizardState['step'] =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= GENERATE_WIZARD_MAX_STEP;

interface ParseParams { uid: string; scope: string; now: number }

/** Accepts only a current, unexpired draft of this user and wizard scope with the expected shape. */
export const parseWizardDraft = (raw: unknown, { uid, scope, now }: ParseParams): WizardDraft | null => {
  if (!isRecord(raw) || raw.version !== WIZARD_DRAFT_VERSION || raw.scope !== scope) return null;
  if (typeof raw.savedAt !== 'number' || now - raw.savedAt > WIZARD_DRAFT_TTL_MS || raw.savedAt - now > 60_000) return null;
  if (!isNullableString(raw.draftBatchId) || typeof raw.submitting !== 'boolean' || !isRecord(raw.dirty)) return null;
  if (!['prompt', 'promptBlocks', 'productScenes'].every((flag) => typeof (raw.dirty as Record<string, unknown>)[flag] === 'boolean')) return null;
  if (!isStringArray(raw.incompleteGarmentNames) || !Array.isArray(raw.garments)) return null;
  const state = raw.state;
  if (!isRecord(state) || !isStep(state.step)) return null;
  if (!isNullableString(state.selectedClientId) || !isNullableString(state.selectedModelId)) return null;
  if (!isNullableString(state.selectedSpreadsheetTemplateId) || !isNullableString(state.selectedSpreadsheetCategoryId)) return null;
  if (!['photos_only', 'spreadsheet'].includes(state.outputMode as string) || typeof state.outputModeChosen !== 'boolean') return null;
  if (state.generationKind !== null && !['garment', 'product'].includes(state.generationKind as string)) return null;
  if (!isStringArray(state.selectedPoseIds) || !isString(state.prompt) || !isRecord(state.tryOnPromptBlocks)) return null;
  if (!isRecord(state.poseSuggestions) || !isRecord(state.productDraftPreparation) || !Array.isArray(state.productDrafts)) return null;
  if (!Array.isArray(state.productScenes) || !isRecord(state.providerImageConfigs)) return null;
  if (state.sourceSpreadsheet !== null && !(isRecord(state.sourceSpreadsheet)
    && isString(state.sourceSpreadsheet.originalFileName)
    && isSafePathUnder(state.sourceSpreadsheet.storagePath, `wizard_source_spreadsheets/${uid}/`))) return null;
  const draftBatchId = raw.draftBatchId;
  if (raw.garments.length > 0 && !draftBatchId) return null;
  const garmentPrefix = `garments/drafts/${uid}/${draftBatchId}/`;
  if (!raw.garments.every((garment) => isDraftGarment(garment, garmentPrefix))) return null;
  return raw as unknown as WizardDraft;
};

export type StoragePathStatus = 'ok' | 'missing' | 'error';

export interface WizardDraftCatalog {
  /** Active clients. */
  clients: Pick<Client, 'id' | 'name'>[];
  /** Active models of the draft client, with only their active poses. */
  models: Pick<Model, 'id' | 'name' | 'poses'>[];
  /** Usable spreadsheet templates of the draft client, or null when not needed. */
  templates: Pick<SpreadsheetTemplate, 'id' | 'name'>[] | null;
  /** Categories of the draft template, or null when not needed. */
  categories: Pick<SpreadsheetTemplateCategory, 'id'>[] | null;
  /** Result of checking each Storage path referenced by the draft. */
  paths: Map<string, { status: StoragePathStatus; url?: string }>;
  /** Providers that exist and are not disabled. */
  enabledProviders?: readonly string[];
}

export interface WizardDraftRestoreResult {
  state: WizardState;
  draftBatchId: string | null;
  dirty: WizardDraftDirtyFlags;
  warnings: string[];
}

const listNames = (names: string[]) => names.length > 3 ? `${names.slice(0, 3).join(', ')} y ${names.length - 3} más` : names.join(', ');

const toGarment = (garment: WizardDraftGarment, draftBatchId: string, paths: WizardDraftCatalog['paths']): UploadedGarmentDraft => {
  const { storagePath, uploadAttempts, originalPhotos, ...rest } = garment;
  const uploaded = (path: string, attempts: number) => ({
    ...createInitialGarmentUploadState(), status: 'uploaded' as const, progress: 100, attempts, storagePath: path, draftBatchId,
  });
  const photos: GarmentOriginalPhotoDraft[] = originalPhotos.map((photo) => ({
    id: photo.id,
    file: null,
    fileName: photo.fileName,
    sourceIndex: photo.sourceIndex,
    previewUrl: paths.get(photo.storagePath)?.url ?? '',
    upload: uploaded(photo.storagePath, uploadAttempts),
    classification: photo.classification,
  }));
  return {
    ...rest,
    files: [],
    previewUrl: photos[0]?.previewUrl ?? '',
    originalPhotos: photos,
    upload: uploaded(storagePath, uploadAttempts),
  };
};

/**
 * Rebuilds wizard state from a parsed draft, dropping every part the current
 * catalog or Storage no longer backs, and explains each drop in `warnings`.
 */
export const restoreWizardDraft = (draft: WizardDraft, catalog: WizardDraftCatalog, base: WizardState): WizardDraftRestoreResult => {
  const warnings: string[] = [];
  const saved = draft.state;
  let invalidateGenerated = false;
  let invalidateProductDrafts = false;

  if (draft.submitting) {
    warnings.push('La página se recargó mientras se creaba el lote. Revisa el Catálogo antes de enviarlo otra vez para no duplicarlo.');
  }
  if (draft.incompleteGarmentNames.length) {
    warnings.push(`No terminaron de subirse y se quitaron: ${listNames(draft.incompleteGarmentNames)}. Vuelve a cargar esas fotos.`);
  }

  let selectedClientId = saved.selectedClientId;
  if (selectedClientId && !catalog.clients.some((client) => client.id === selectedClientId)) {
    warnings.push('El cliente guardado ya no está disponible. Elige otro cliente para continuar.');
    selectedClientId = null;
  }

  let selectedModelId = selectedClientId ? saved.selectedModelId : null;
  const model = selectedModelId ? catalog.models.find((entry) => entry.id === selectedModelId) : undefined;
  if (selectedModelId && !model) {
    if (selectedClientId) warnings.push('El modelo guardado ya no está activo. Elige otro modelo.');
    selectedModelId = null;
  }

  const activePoseIds = new Set((model?.poses ?? []).map((pose) => pose.id));
  const selectedPoseIds = model ? saved.selectedPoseIds.filter((id) => activePoseIds.has(id)) : [];
  const droppedPoses = saved.selectedPoseIds.length - selectedPoseIds.length;
  if (model && droppedPoses > 0) {
    warnings.push(`${droppedPoses} pose(s) seleccionada(s) ya no están activas y se quitaron.`);
  }

  const missingGarments: string[] = [];
  const unverifiedGarments: string[] = [];
  const garments = draft.draftBatchId
    ? draft.garments.filter((garment) => {
      const statuses = garment.originalPhotos.map((photo) => catalog.paths.get(photo.storagePath)?.status ?? 'error');
      if (statuses.includes('missing')) {
        missingGarments.push(garment.name);
        return false;
      }
      if (statuses.includes('error')) unverifiedGarments.push(garment.name);
      return true;
    }).map((garment) => toGarment(garment, draft.draftBatchId!, catalog.paths))
    : [];
  if (missingGarments.length) {
    warnings.push(`Las fotos de ${listNames(missingGarments)} ya no existen en Storage y se quitaron.`);
    invalidateGenerated = true;
  }
  if (unverifiedGarments.length) {
    warnings.push(`No se pudo cargar la vista previa de ${listNames(unverifiedGarments)}.`);
  }

  let outputMode = selectedClientId ? saved.outputMode : base.outputMode;
  let selectedSpreadsheetTemplateId = selectedClientId ? saved.selectedSpreadsheetTemplateId : null;
  let selectedSpreadsheetCategoryId = selectedClientId ? saved.selectedSpreadsheetCategoryId : null;
  if (selectedSpreadsheetTemplateId && catalog.templates && !catalog.templates.some((template) => template.id === selectedSpreadsheetTemplateId)) {
    warnings.push('El spreadsheet guardado ya no está disponible. Se cambió a solo fotos.');
    outputMode = 'photos_only';
    selectedSpreadsheetTemplateId = null;
    selectedSpreadsheetCategoryId = null;
    invalidateProductDrafts = true;
  }
  if (selectedSpreadsheetCategoryId && catalog.categories && !catalog.categories.some((category) => category.id === selectedSpreadsheetCategoryId)) {
    warnings.push('La categoría guardada del spreadsheet ya no existe. Elige otra.');
    selectedSpreadsheetCategoryId = null;
    invalidateProductDrafts = true;
  }
  if (outputMode !== 'spreadsheet') {
    selectedSpreadsheetTemplateId = null;
    selectedSpreadsheetCategoryId = null;
  }

  let sourceSpreadsheet: WizardState['sourceSpreadsheet'] = null;
  if (selectedClientId && saved.sourceSpreadsheet) {
    if (catalog.paths.get(saved.sourceSpreadsheet.storagePath)?.status === 'missing') {
      warnings.push(`El spreadsheet fuente ${saved.sourceSpreadsheet.originalFileName} ya no existe. Vuelve a cargarlo.`);
      invalidateProductDrafts = true;
    } else {
      sourceSpreadsheet = { ...saved.sourceSpreadsheet, status: 'uploaded', error: null };
    }
  }

  const provider = isProvider(saved.provider) && (!catalog.enabledProviders || catalog.enabledProviders.includes(saved.provider))
    ? saved.provider
    : base.provider;
  if (provider !== saved.provider) warnings.push('El proveedor guardado ya no está disponible. Se usará el predeterminado.');
  const providerImageConfigs = { ...base.providerImageConfigs };
  for (const [key, config] of Object.entries(saved.providerImageConfigs)) {
    if (isProvider(key) && key in providerImageConfigs && isRecord(config) && config.provider === key) {
      providerImageConfigs[key] = config as typeof providerImageConfigs[typeof key];
    }
  }

  const knownSceneTypes = new Set<string>(PRODUCT_SCENES.map((scene) => scene.type));
  const productScenes = saved.productScenes.filter((scene) => isRecord(scene) && knownSceneTypes.has(scene.type as string) && isString(scene.prompt));

  const clientLost = Boolean(saved.selectedClientId && !selectedClientId);
  const modelLost = Boolean(saved.selectedModelId && !selectedModelId);
  const keepProductDrafts = !invalidateGenerated && !invalidateProductDrafts && !clientLost && !modelLost
    && saved.productDraftPreparation.status === 'ready';
  const keepPoseSuggestions = !invalidateGenerated && !modelLost && droppedPoses === 0 && saved.poseSuggestions.status === 'ready';

  const state: WizardState = {
    ...base,
    step: saved.step,
    generationKind: garments.length ? saved.generationKind : null,
    selectedClientId,
    selectedModelId,
    outputMode,
    outputModeChosen: saved.outputModeChosen,
    selectedSpreadsheetTemplateId,
    selectedSpreadsheetCategoryId,
    sourceSpreadsheet,
    sourceSpreadsheetSummary: keepProductDrafts ? saved.sourceSpreadsheetSummary : null,
    selectedPoseIds,
    garments,
    poseSuggestions: keepPoseSuggestions
      ? { ...saved.poseSuggestions, suggestedPoseIds: saved.poseSuggestions.suggestedPoseIds.filter((id) => activePoseIds.has(id)) }
      : createInitialPoseSuggestionState(),
    productDrafts: keepProductDrafts ? saved.productDrafts.filter((entry) => garments.some((garment) => garment.id === entry.garmentId)) : [],
    productDraftPreparation: keepProductDrafts ? saved.productDraftPreparation : createInitialProductDraftPreparationState(),
    productScenes: productScenes.length ? productScenes : base.productScenes,
    provider,
    providerImageConfigs,
    prompt: saved.prompt,
    tryOnPromptBlocks: { ...base.tryOnPromptBlocks, ...saved.tryOnPromptBlocks },
  };

  return {
    state,
    draftBatchId: garments.length ? draft.draftBatchId : null,
    dirty: clientLost ? { ...draft.dirty, prompt: false, promptBlocks: false } : draft.dirty,
    warnings,
  };
};

/** Every Storage path a draft depends on, to check before restoring. */
export const collectWizardDraftPaths = (draft: WizardDraft): { images: string[]; files: string[] } => ({
  images: draft.garments.flatMap((garment) => garment.originalPhotos.map((photo) => photo.storagePath)),
  files: draft.state.sourceSpreadsheet ? [draft.state.sourceSpreadsheet.storagePath] : [],
});
