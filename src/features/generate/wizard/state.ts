import {
  DEFAULT_TRY_ON_PROMPT,
  PROVIDER_LABELS,
} from '../../../../shared/src/domain';
import { EXPERIMENT_ALLOWED_PROVIDERS } from '../../../../shared/src/experiments';
import { WizardStepDefinition } from '../../wizard/types';
import {
  GarmentUploadState,
  GenerateSubmitStage,
  UploadedGarmentDraft,
  UploadSummary,
  WizardState,
} from '../types';

export const GENERATE_WIZARD_STEPS: WizardStepDefinition[] = [
  { id: 1, name: 'Cliente y modelo' },
  { id: 2, name: 'Prendas' },
  { id: 3, name: 'Lote' },
];

export const GENERATE_WIZARD_MAX_STEP = GENERATE_WIZARD_STEPS[GENERATE_WIZARD_STEPS.length - 1]?.id ?? 3;

export const createInitialGenerateWizardState = (): WizardState => ({
  step: 1,
  selectedClientId: null,
  selectedModelId: null,
  selectedPoseIds: [],
  garments: [],
  provider: 'fal-seedream',
  experiment: {
    enabled: false,
    mode: 'ab_paired',
    providers: [...EXPERIMENT_ALLOWED_PROVIDERS],
  },
  prompt: DEFAULT_TRY_ON_PROMPT,
  aspectRatio: '3:4',
});

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

export const getGarmentUploadProgressWidth = (
  upload: GarmentUploadState,
  minimumProgress = 4,
): string => `${Math.max(upload.progress, upload.status === 'uploaded' ? 100 : minimumProgress)}%`;

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

export const getGenerateWizardExperimentMultiplier = (state: WizardState): number =>
  state.experiment.enabled && state.experiment.mode === 'ab_paired'
    ? state.experiment.providers.length
    : 1;

export const getGenerateWizardTotalJobs = (state: WizardState): number =>
  state.selectedPoseIds.length * state.garments.length * getGenerateWizardExperimentMultiplier(state);

export const isGenerateWizardStepComplete = (state: WizardState, stepId: number): boolean => {
  switch (stepId) {
    case 1:
      return Boolean(state.selectedClientId && state.selectedModelId && state.selectedPoseIds.length > 0);
    case 2:
      return state.garments.length > 0;
    case 3:
      return true;
    default:
      return false;
  }
};

export const getGenerateWizardCanAdvance = (state: WizardState): boolean =>
  isGenerateWizardStepComplete(state, state.step);

export const getGenerateWizardExperimentProviderError = (state: WizardState): string | null => {
  if (!state.experiment.enabled) {
    return null;
  }

  if (state.experiment.providers.length !== 2 || new Set(state.experiment.providers).size !== 2) {
    return 'El experimento A/B necesita exactamente dos modelos distintos.';
  }

  return null;
};

export const GENERATE_WIZARD_EXPERIMENT_PROVIDER_OPTIONS = EXPERIMENT_ALLOWED_PROVIDERS.map((provider) => ({
  provider,
  label: PROVIDER_LABELS[provider],
}));

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
