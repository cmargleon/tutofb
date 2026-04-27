import React, { useState } from 'react';
import { SourceSpreadsheetMatchSummary } from '../../../shared/src/types';
import { WizardProviderImageConfig, WizardState } from '../../features/generate/types';
import { PromptBaseField } from './PromptBaseField';
import { ProviderImageConfigSelection } from './ProviderImageConfigSelection';
import { ProviderSelection } from './ProviderSelection';

interface Props {
  state: WizardState;
  isSubmitting: boolean;
  totalJobs: number;
  submitButtonLabel: string;
  promptSourceLabel: string;
  disabledProviders?: string[];
  productDraftPreparationStatus: WizardState['productDraftPreparation']['status'];
  productDraftPreparationError: string | null;
  sourceSpreadsheet: WizardState['sourceSpreadsheet'];
  sourceSpreadsheetSummary: SourceSpreadsheetMatchSummary | null;
  onRetryProductDraftPreparation: () => void;
  onProviderChange: (provider: WizardState['provider']) => void;
  onProviderImageConfigChange: (config: WizardProviderImageConfig) => void;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
}

export const BatchStep: React.FC<Props> = ({
  state,
  isSubmitting,
  totalJobs,
  submitButtonLabel,
  promptSourceLabel,
  disabledProviders,
  productDraftPreparationStatus,
  productDraftPreparationError,
  sourceSpreadsheet,
  sourceSpreadsheetSummary,
  onRetryProductDraftPreparation,
  onProviderChange,
  onProviderImageConfigChange,
  onPromptChange,
  onSubmit,
}) => {
  const [providerChosen, setProviderChosen] = useState(false);

  const handleProviderSelect = (provider: WizardState['provider']) => {
    setProviderChosen(true);
    onProviderChange(provider);
  };

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
  const selectedProviderDisabled = Boolean(disabledProviders?.includes(state.provider));
  const sourceSpreadsheetPending = state.outputMode === 'spreadsheet' && sourceSpreadsheet?.status === 'uploading';
  const sourceSpreadsheetFailed = state.outputMode === 'spreadsheet' && sourceSpreadsheet?.status === 'failed';
  const isSubmitDisabled = (
    isSubmitting
    || totalJobs === 0
    || spreadsheetPreparationPending
    || spreadsheetPreparationFailed
    || sourceSpreadsheetPending
    || sourceSpreadsheetFailed
    || selectedProviderDisabled
  );

  return (
    <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <ProviderSelection provider={providerChosen ? state.provider : null} onChange={handleProviderSelect} disabledProviders={disabledProviders} />

      {providerChosen && (
        <>
          {selectedProviderDisabled ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Este modelo IA está deshabilitado en Configuración. Sigue visible para referencia, pero no se puede usar para crear nuevos lotes.
            </div>
          ) : null}

          {state.outputMode === 'spreadsheet' ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Preparación del spreadsheet</h3>
              {sourceSpreadsheet ? (
                <p className="mt-2 text-sm text-slate-600">
                  {sourceSpreadsheet.status === 'uploading'
                    ? `Subiendo ${sourceSpreadsheet.originalFileName} para preparar el matching.`
                    : sourceSpreadsheet.status === 'failed'
                      ? sourceSpreadsheet.error || 'Falló la subida del spreadsheet fuente.'
                      : `Usaremos ${sourceSpreadsheet.originalFileName} como fuente adicional para completar el lote.`}
                </p>
              ) : null}
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
              {sourceSpreadsheetSummary ? (
                <div className="mt-3 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 md:grid-cols-3">
                  <div>Total filas útiles: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.totalRows}</span></div>
                  <div>Filas matcheadas: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.matchedRows}</span></div>
                  <div>Prendas sin match: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.unmatchedGarments}</span></div>
                  <div>Filas ignoradas: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.ignoredRows}</span></div>
                  <div>Filas que heredaron foto por SPU: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.reusedSpuPhotoRows}</span></div>
                  <div>Filas con foto: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.rowsWithPhotos}</span></div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={selectedProviderDisabled ? 'pointer-events-none opacity-60' : undefined}>
            <ProviderImageConfigSelection
              provider={state.provider}
              value={state.providerImageConfigs[state.provider]}
              onChange={onProviderImageConfigChange}
            />
          </div>
          <PromptBaseField value={state.prompt} onChange={onPromptChange} sourceLabel={promptSourceLabel} />

          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitDisabled}
            className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitButtonLabel}
          </button>
        </>
      )}
    </div>
  );
};
