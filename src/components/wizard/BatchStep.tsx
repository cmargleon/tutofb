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
  promptSourceLabel: string;
  disabledProviders?: string[];
  productDraftPreparationStatus: WizardState['productDraftPreparation']['status'];
  productDraftPreparationError: string | null;
  onRetryProductDraftPreparation: () => void;
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
  promptSourceLabel,
  disabledProviders,
  productDraftPreparationStatus,
  productDraftPreparationError,
  onRetryProductDraftPreparation,
  onProviderChange,
  onProviderImageConfigChange,
  onPromptChange,
  onSubmit,
}) => {
  const spreadsheetPreparationPending = (
    state.outputMode === 'spreadsheet'
    && (
      productDraftPreparationStatus === 'preparing'
      || productDraftPreparationStatus === 'idle'
    )
  );
  const spreadsheetPreparationFailed = (
    state.outputMode === 'spreadsheet'
    && productDraftPreparationStatus === 'failed'
  );
  const isSubmitDisabled = (
    isSubmitting
    || totalJobs === 0
    || spreadsheetPreparationPending
    || spreadsheetPreparationFailed
  );

  return (
    <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <BatchUploadSummary garments={garments} uploadSummary={uploadSummary} />
      <ProviderSelection provider={state.provider} onChange={onProviderChange} disabledProviders={disabledProviders} />

      {state.outputMode === 'spreadsheet' ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Preparación del spreadsheet</h3>
          {productDraftPreparationStatus === 'failed' ? (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-rose-700">
                {productDraftPreparationError || 'No se pudieron preparar los product drafts para este lote.'}
              </p>
              <button
                type="button"
                onClick={onRetryProductDraftPreparation}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-slate-100"
              >
                Reintentar preparación
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              {spreadsheetPreparationPending
                ? 'Estamos preparando los product drafts automáticamente antes de crear el lote.'
                : 'Los product drafts quedaron listos y se van a incluir en el lote.'}
            </p>
          )}
        </div>
      ) : null}

      <ProviderImageConfigSelection
        provider={state.provider}
        value={state.providerImageConfigs[state.provider]}
        onChange={onProviderImageConfigChange}
      />
      <PromptBaseField value={state.prompt} onChange={onPromptChange} sourceLabel={promptSourceLabel} />

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitDisabled}
        className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitButtonLabel}
      </button>
    </div>
  );
};
