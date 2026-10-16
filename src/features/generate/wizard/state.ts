import {
  DEFAULT_TRY_ON_PROMPT,
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
  { id: 1, name: 'Cliente, modelo y salida' },
  { id: 2, name: 'Prendas' },
  { id: 3, name: 'Poses sugeridas' },
  { id: 4, name: 'Lote' },
];

export const GENERATE_WIZARD_MAX_STEP = GENERATE_WIZARD_STEPS[GENERATE_WIZARD_STEPS.length - 1]?.id ?? 4;

export const createInitialGenerateWizardState = (): WizardState => ({
  step: 1,
  selectedClientId: null,
  selectedModelId: null,
  outputMode: 'spreadsheet',
  outputModeChosen: false,
  selectedSpreadsheetTemplateId: null,
  selectedSpreadsheetCategoryId: null,
  sourceSpreadsheet: null,
  sourceSpreadsheetSummary: null,
  selectedPoseIds: [],
  garments: [],
  poseSuggestions: createInitialPoseSuggestionState(),
  productDrafts: [],
  productDraftPreparation: createInitialProductDraftPreparationState(),
  provider: 'fal-seedream',
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
  prompt: DEFAULT_TRY_ON_PROMPT,
});

export const getSelectedProviderImageConfig = (state: WizardState) => state.providerImageConfigs[state.provider];

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
): number => compatiblePairCount;

export const isGenerateWizardStepComplete = (state: WizardState, stepId: number): boolean => {
  switch (stepId) {
    case 1:
      return Boolean(
        state.selectedClientId
        && state.selectedModelId
        && (
          state.outputMode === 'photos_only'
          || state.selectedSpreadsheetTemplateId
        ),
      );
    case 2:
      return state.garments.length > 0;
    case 3:
      return state.selectedPoseIds.length > 0;
    case 4:
      return true;
    default:
      return false;
  }
};

export const getGenerateWizardCanAdvance = (state: WizardState): boolean =>
  isGenerateWizardStepComplete(state, state.step)
  && !(state.step === 3 && state.poseSuggestions.status === 'preparing')
  && !(state.step === 4 && state.productDraftPreparation.status === 'preparing');

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
