import React from 'react';
import { UploadedGarmentDraft, UploadSummary, WizardProviderImageConfig, WizardState } from '../../features/generate/types';
import { BatchUploadSummary } from './BatchUploadSummary';
import { PromptBaseField } from './PromptBaseField';
import { ProviderImageConfigSelection } from './ProviderImageConfigSelection';
import { ProviderSelection } from './ProviderSelection';

interface Props {
  state: WizardState;
  garments: UploadedGarmentDraft[];
  isSubmitting: boolean;
  totalJobs: number;
  uploadSummary: UploadSummary;
  submitButtonLabel: string;
  disabledProviders?: string[];
  onProviderChange: (provider: WizardState['provider']) => void;
  onProviderImageConfigChange: (config: WizardProviderImageConfig) => void;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
}

export const BatchStep: React.FC<Props> = ({
  state,
  garments,
  isSubmitting,
  totalJobs,
  uploadSummary,
  submitButtonLabel,
  disabledProviders,
  onProviderChange,
  onProviderImageConfigChange,
  onPromptChange,
  onSubmit,
}) => (
  <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
    <BatchUploadSummary garments={garments} uploadSummary={uploadSummary} />
    <ProviderSelection provider={state.provider} onChange={onProviderChange} disabledProviders={disabledProviders} />

    <ProviderImageConfigSelection
      provider={state.provider}
      value={state.providerImageConfigs[state.provider]}
      onChange={onProviderImageConfigChange}
    />
    <PromptBaseField value={state.prompt} onChange={onPromptChange} />

    <button
      type="button"
      onClick={onSubmit}
      disabled={isSubmitting || totalJobs === 0}
      className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitButtonLabel}
    </button>
  </div>
);
