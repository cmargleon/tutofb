import React from 'react';
import { Provider } from '../../../shared/src/types';
import { UploadedGarmentDraft, UploadSummary, WizardState } from '../../features/generate/types';
import { AspectRatioSelection } from './AspectRatioSelection';
import { BatchUploadSummary } from './BatchUploadSummary';
import { ExperimentSettings } from './ExperimentSettings';
import { PromptBaseField } from './PromptBaseField';
import { ProviderSelection } from './ProviderSelection';

interface Props {
  state: WizardState;
  garments: UploadedGarmentDraft[];
  isSubmitting: boolean;
  totalJobs: number;
  uploadSummary: UploadSummary;
  experimentProviderError: string | null;
  experimentProviderOptions: { provider: Provider; label: string }[];
  submitButtonLabel: string;
  onToggleExperiment: () => void;
  onExperimentModeChange: (mode: 'ab_paired' | 'ab_interleaved') => void;
  onExperimentProviderChange: (index: number, provider: Provider) => void;
  onProviderChange: (provider: Provider) => void;
  onAspectRatioChange: (ratio: WizardState['aspectRatio']) => void;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
}

export const BatchStep: React.FC<Props> = ({
  state,
  garments,
  isSubmitting,
  totalJobs,
  uploadSummary,
  experimentProviderError,
  experimentProviderOptions,
  submitButtonLabel,
  onToggleExperiment,
  onExperimentModeChange,
  onExperimentProviderChange,
  onProviderChange,
  onAspectRatioChange,
  onPromptChange,
  onSubmit,
}) => (
  <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
    <BatchUploadSummary garments={garments} uploadSummary={uploadSummary} />

    <div className="space-y-5">
      <ExperimentSettings
        experiment={state.experiment}
        providerOptions={experimentProviderOptions}
        error={experimentProviderError}
        onToggle={onToggleExperiment}
        onModeChange={onExperimentModeChange}
        onProviderChange={onExperimentProviderChange}
      />

      {!state.experiment.enabled ? (
        <ProviderSelection provider={state.provider} onChange={onProviderChange} />
      ) : null}
    </div>

    <AspectRatioSelection value={state.aspectRatio} onChange={onAspectRatioChange} />
    <PromptBaseField value={state.prompt} onChange={onPromptChange} />

    <button
      type="button"
      onClick={onSubmit}
      disabled={isSubmitting || totalJobs === 0 || Boolean(experimentProviderError)}
      className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitButtonLabel}
    </button>
  </div>
);
