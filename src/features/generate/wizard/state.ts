import { seedTryOnPrompt } from '../../../../shared/src/approvedTryOnPrompt';
import { createDefaultProductScenes } from '../../../../shared/src/productGeneration';
import {
  DEFAULT_TRY_ON_PROMPT,
  DEFAULT_IMAGE_PROVIDER,
} from '../../../../shared/src/domain';
import { createDefaultProviderImageConfig } from '../../../../shared/src/providerImageConfig';
import { WizardStepDefinition } from '../../wizard/types';
import {
  GarmentUploadState,
  GenerateSubmitStage,
  UploadedGarmentDraft,
  UploadSummary,
  WizardState,
  createInitialProductDraftPreparationState,
  createInitialPoseSuggestionState,
} from '../types';

export const GENERATE_WIZARD_STEPS: WizardStepDefinition[] = [
  { id: 1, name: 'Cliente y fotos' },
  { id: 2, name: 'Preparar fotos' },
  { id: 3, name: 'Revisar y generar' },
];

export const GENERATE_WIZARD_MAX_STEP = 3;

export const createInitialGenerateWizardState = (): WizardState => ({
  step: 1,
  generationKind: null,
  productScenes: createDefaultProductScenes(),
  selectedClientId: null,
  selectedModelId: null,
  outputMode: 'photos_only',
  outputModeChosen: true,
  selectedSpreadsheetTemplateId: null,
  selectedSpreadsheetCategoryId: null,
  sourceSpreadsheet: null,
  sourceSpreadsheetSummary: null,
  selectedPoseIds: [],
  garments: [],
  poseSuggestions: createInitialPoseSuggestionState(),
  productDrafts: [],
  productDraftPreparation: createInitialProductDraftPreparationState(),
  provider: DEFAULT_IMAGE_PROVIDER,
  providerImageConfigs: {
    'fal-seedream': createDefaultProviderImageConfig('fal-seedream'),
    'fal-banana-pro': createDefaultProviderImageConfig('fal-banana-pro'),
    'openai-gpt-image-1.5': createDefaultProviderImageConfig('openai-gpt-image-1.5'),
    'fal-nano-banana-2': createDefaultProviderImageConfig('fal-nano-banana-2'),
    'fal-seedream-5': createDefaultProviderImageConfig('fal-seedream-5'),
    'fal-gpt-image-2': createDefaultProviderImageConfig('fal-gpt-image-2'),
    'fal-gpt-image-2.5-sunburst': createDefaultProviderImageConfig('fal-gpt-image-2.5-sunburst'),
    'fal-gpt-image-2.5-flare': createDefaultProviderImageConfig('fal-gpt-image-2.5-flare'),
    'fal-seedream-5-pro': createDefaultProviderImageConfig('fal-seedream-5-pro'),
    'fal-seedream-5-flash': createDefaultProviderImageConfig('fal-seedream-5-flash'),
    'fal-flux-2-edit': createDefaultProviderImageConfig('fal-flux-2-edit'),
  },
  prompt: seedTryOnPrompt(DEFAULT_TRY_ON_PROMPT).general,
  tryOnPromptBlocks: seedTryOnPrompt(DEFAULT_TRY_ON_PROMPT).blocks,
});

export const getSelectedProviderImageConfig = (state: WizardState) => state.providerImageConfigs[state.provider];

export const selectGenerateWizardProvider = (state: WizardState, provider: WizardState['provider']): WizardState => {
  const config = state.providerImageConfigs[provider];
  const imageConfig = 'imageSize' in config
    ? { ...config, imageSize: 'portrait_4_3' as const }
    : 'aspectRatio' in config
      ? { ...config, aspectRatio: '3:4' as const }
      : config;
  return { ...state, provider, providerImageConfigs: { ...state.providerImageConfigs, [provider]: imageConfig } };
};

export const createEmptyUploadSummary = (): UploadSummary => ({
  total: 0,
  uploaded: 0,
  failed: 0,
  queued: 0,
  inFlight: 0,
  idle: 0,
  started: 0,
});

export const buildGarmentUploadSummary = (garments: UploadedGarmentDraft[]): UploadSummary =>
  garments.reduce((summary, garment) => {
    summary.total += 1;

    switch (garment.upload.status) {
      case 'uploaded':
        summary.uploaded += 1;
        break;
      case 'failed':
        summary.failed += 1;
        break;
      case 'queued':
        summary.queued += 1;
        break;
      case 'uploading':
      case 'retrying':
        summary.inFlight += 1;
        break;
      case 'idle':
      default:
        summary.idle += 1;
        break;
    }

    if (garment.upload.status !== 'idle') {
      summary.started += 1;
    }

    return summary;
  }, createEmptyUploadSummary());

export const getGarmentUploadStatusCopy = (
  upload: GarmentUploadState,
): { label: string; tone: string; bar: string } => {
  switch (upload.status) {
    case 'queued':
      return { label: 'En cola', tone: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400' };
    case 'uploading':
      return { label: 'Subiendo', tone: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500' };
    case 'retrying':
      return {
        label: `Reintento ${Math.max(upload.attempts, 1)}`,
        tone: 'bg-amber-100 text-amber-800',
        bar: 'bg-amber-500',
      };
    case 'uploaded':
      return { label: 'Lista', tone: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' };
    case 'failed':
      return { label: 'Falló', tone: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500' };
    case 'idle':
    default:
      return { label: 'Pendiente', tone: 'bg-slate-100 text-slate-600', bar: 'bg-slate-300' };
  }
};

export const getGarmentUploadProgressValue = (
  upload: GarmentUploadState,
  minimumProgress = 4,
): number => Math.max(upload.progress, upload.status === 'uploaded' ? 100 : minimumProgress);

export const isGarmentUploadedForBatch = (
  garment: UploadedGarmentDraft,
  draftBatchId: string | null,
): boolean =>
  Boolean(
    draftBatchId
      && garment.upload.status === 'uploaded'
      && garment.upload.storagePath
      && garment.upload.draftBatchId === draftBatchId,
  );

export const getGenerateWizardTotalJobs = (
  state: WizardState,
  compatiblePairCount: number = state.selectedPoseIds.length * state.garments.length,
): number => state.generationKind === 'product' ? state.garments.length * state.productScenes.length : compatiblePairCount;

export const isGenerateWizardStepComplete = (state: WizardState, stepId: number): boolean => {
  switch (stepId) {
    case 1:
      return Boolean(
        state.selectedClientId
        && state.generationKind
        && resolveWizardGenerationKind(state.garments) === state.generationKind,
      );
    case 2:
      return state.generationKind === 'product'
        ? state.productScenes.length > 0 && state.productScenes.every((scene) => Boolean(scene.prompt.trim()))
        : state.generationKind === 'garment' && Boolean(state.selectedModelId) && state.selectedPoseIds.length > 0;
    case 3:
      return state.outputMode === 'photos_only' || Boolean(state.selectedSpreadsheetTemplateId);
    default:
      return false;
  }
};

export const getGenerateWizardCanAdvance = (state: WizardState): boolean =>
  isGenerateWizardStepComplete(state, state.step)
  && !state.garments.some((garment) => garment.analysisStatus === 'preparing')
  && !(state.step === 2 && state.poseSuggestions.status === 'preparing')
  && !(state.step === 3 && state.productDraftPreparation.status === 'preparing');

export const getGenerateWizardLastAccessibleStep = (
  state: WizardState,
): WizardState['step'] => {
  let lastAccessibleStep: WizardState['step'] = 1;

  for (let stepId = 2; stepId <= GENERATE_WIZARD_MAX_STEP; stepId += 1) {
    if (!isGenerateWizardStepComplete(state, stepId - 1)) {
      break;
    }

    lastAccessibleStep = stepId as WizardState['step'];
  }

  return lastAccessibleStep;
};

interface SubmitButtonLabelParams {
  isSubmitting: boolean;
  submitStage: GenerateSubmitStage;
  uploadedGarmentCount: number;
  garmentCount: number;
  totalJobs: number;
  uploadSummary: UploadSummary;
}

export const getGenerateWizardSubmitButtonLabel = ({
  isSubmitting,
  submitStage,
  uploadedGarmentCount,
  garmentCount,
  totalJobs,
  uploadSummary,
}: SubmitButtonLabelParams): string => {
  if (!isSubmitting) {
    const garmentLabel = uploadedGarmentCount > 0 ? ` · ${uploadedGarmentCount}/${garmentCount} prendas listas` : '';
    return `Crear lote y abrir evaluación (${totalJobs})${garmentLabel}`;
  }

  if (submitStage === 'uploading') {
    return `Subiendo prendas (${uploadSummary.uploaded}/${uploadSummary.total})`;
  }

  return 'Creando lote...';
};

export const getGenerateWizardSteps = (_kind: WizardState['generationKind']): WizardStepDefinition[] => GENERATE_WIZARD_STEPS;

export const getEffectiveItemKind = (garment: UploadedGarmentDraft): WizardState['generationKind'] =>
  garment.itemKindOverride || ((garment.itemKindConfidence ?? 0) >= 0.65 ? garment.itemKind ?? null : null);

export const resolveWizardGenerationKind = (garments: UploadedGarmentDraft[]): WizardState['generationKind'] => {
  if (garments.length === 0 || garments.some((garment) => garment.analysisStatus !== 'ready')) return null;
  const kinds = garments.map(getEffectiveItemKind);
  return kinds[0] && kinds.every((kind) => kind === kinds[0]) ? kinds[0] : null;
};

export const resolveWizardMajorityKind = (garments: UploadedGarmentDraft[]): WizardState['generationKind'] => {
  if (!garments.length || garments.some((garment) => garment.analysisStatus !== 'ready' || !getEffectiveItemKind(garment))) return null;
  const garmentCount = garments.filter((garment) => getEffectiveItemKind(garment) === 'garment').length;
  const productCount = garments.length - garmentCount;
  return garmentCount === productCount ? null : garmentCount > productCount ? 'garment' : 'product';
};
