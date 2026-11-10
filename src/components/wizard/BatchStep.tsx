import { ProductPromptField } from './ProductPromptField';
import { ProviderCostEstimate } from './ProviderCostEstimate';
import React from 'react';
import { SourceSpreadsheetMatchSummary } from '../../../shared/src/types';
import { WizardProviderImageConfig, WizardState } from '../../features/generate/types';
import { TryOnPromptFields } from './TryOnPromptFields';
import { composeApprovedTryOnPrompt, validateApprovedTryOnPrompt } from '../../../shared/src/approvedTryOnPrompt';
import { ProviderImageConfigSelection } from './ProviderImageConfigSelection';
import { ProviderSelection } from './ProviderSelection';
import { isGenerateWizardStepComplete } from '../../features/generate/wizard/state';

interface Props {
  clientName?: string;
  modelName?: string;
  state: WizardState;
  isSubmitting: boolean;
  totalJobs: number;
  submitButtonLabel: string;
  promptSourceLabel: string;
  disabledProviders?: string[];
  defaultProductPrompt?: string;
  productDraftPreparationStatus: WizardState['productDraftPreparation']['status'];
  productDraftPreparationError: string | null;
  sourceSpreadsheet: WizardState['sourceSpreadsheet'];
  sourceSpreadsheetSummary: SourceSpreadsheetMatchSummary | null;
  onRetryProductDraftPreparation: () => void;
  onProviderChange: (provider: WizardState['provider']) => void;
  onProviderImageConfigChange: (config: WizardProviderImageConfig) => void;
  onPromptChange: (prompt: string) => void;
  onPromptBlocksChange: (blocks: WizardState['tryOnPromptBlocks']) => void;
  onSubmit: () => void;
}

export const BatchStep: React.FC<Props> = ({
  clientName,
  modelName,
  state,
  isSubmitting,
  totalJobs,
  submitButtonLabel,
  promptSourceLabel,
  disabledProviders,
  defaultProductPrompt,
  productDraftPreparationStatus,
  productDraftPreparationError,
  sourceSpreadsheet,
  sourceSpreadsheetSummary,
  onRetryProductDraftPreparation,
  onProviderChange,
  onProviderImageConfigChange,
  onPromptChange,
  onPromptBlocksChange,
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
  const selectedProviderDisabled = Boolean(disabledProviders?.includes(state.provider));
  const sourceSpreadsheetPending = state.outputMode === 'spreadsheet' && sourceSpreadsheet?.status === 'uploading';
  const sourceSpreadsheetFailed = state.outputMode === 'spreadsheet' && sourceSpreadsheet?.status === 'failed';
  const invalidPrompt = !state.marketplacePhotoPlan && state.generationKind === 'garment' && state.garments.some((garment) => {
    try { validateApprovedTryOnPrompt(composeApprovedTryOnPrompt(state.prompt, state.tryOnPromptBlocks, garment.garmentBodyArea)); return false; }
    catch { return true; }
  });
  const isSubmitDisabled = (
    ![1, 2, 3].every((step) => isGenerateWizardStepComplete(state, step)) ||
    invalidPrompt ||
    isSubmitting
    || totalJobs === 0
    || (!state.marketplacePhotoPlan && spreadsheetPreparationPending)
    || (!state.marketplacePhotoPlan && spreadsheetPreparationFailed)
    || (!state.marketplacePhotoPlan && state.outputMode === 'spreadsheet' && state.productDrafts.length !== state.garments.length)
    || sourceSpreadsheetPending
    || sourceSpreadsheetFailed
    || selectedProviderDisabled
  );

  return (
    <fieldset disabled={isSubmitting} className="min-w-0 space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Revisar y generar</h2>
          <p className="mt-1 text-sm text-slate-600">{clientName} · {state.garments.length} artículo(s){state.marketplacePhotoPlan ? ' · Plan de marketplaces' : state.generationKind === 'garment' ? ` · ${modelName} · ${state.selectedPoseIds.length} poses seleccionadas` : ` · ${state.productScenes.length} escenas por artículo`}</p>
          <p className="mt-1 text-xs text-slate-500">{state.marketplacePhotoPlan ? 'Fotos y selección por marketplace · exportación desde Catálogo' : state.outputMode === 'spreadsheet' ? 'Fotos + spreadsheet' : 'Solo fotos'}</p>
        </div>
        <p className="text-2xl font-semibold text-emerald-700">{totalJobs} <span className="text-sm font-normal">imágenes</span></p>
      </div>
      <ProviderSelection provider={state.provider} onChange={onProviderChange} disabledProviders={disabledProviders} />
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
                <div className="mt-3 space-y-3">
                  <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 md:grid-cols-3">
                    <div>Total filas útiles: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.totalRows}</span></div>
                    <div>Filas matcheadas: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.matchedRows}</span></div>
                    <div>Prendas sin match: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.unmatchedGarments}</span></div>
                    <div>Filas ignoradas: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.ignoredRows}</span></div>
                    <div>Filas con foto: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.rowsWithPhotos}</span></div>
                    <div>Filas solo texto: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.textOnlyRows ?? 0}</span></div>
                    <div>Match por imagen/mixto: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.matchedByImage ?? 0}</span></div>
                    <div>Match por datos: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.matchedByText ?? 0}</span></div>
                    <div>Confianza media: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.needsReviewMatches ?? 0}</span></div>
                    <div>Filas que heredaron foto por código: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.reusedSpuPhotoRows}</span></div>
                    <div>Hoja: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.sheetName || 'Detectada'}</span></div>
                    <div>Header fila: <span className="font-semibold text-slate-900">{sourceSpreadsheetSummary.headerRowNumber || '-'}</span></div>
                  </div>
                  {sourceSpreadsheetSummary.detectedColumns?.length ? (
                    <p className="text-xs text-slate-500">
                      Columnas detectadas: {sourceSpreadsheetSummary.detectedColumns.join(', ')}.
                    </p>
                  ) : null}
                  {sourceSpreadsheetSummary.warnings?.length ? (
                    <div className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {sourceSpreadsheetSummary.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={selectedProviderDisabled ? 'pointer-events-none opacity-60' : undefined}>
            <ProviderImageConfigSelection commercial
              provider={state.provider}
              value={state.providerImageConfigs[state.provider]}
              onChange={onProviderImageConfigChange}
            />
          </div>
          {state.marketplacePhotoPlan ? <details className="rounded-2xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Ajustes avanzados · Instrucciones generales</summary><div className="mt-4"><ProductPromptField value={state.prompt} scenes={[]} defaultPrompt={defaultProductPrompt} disabled={isSubmitting} onChange={onPromptChange} /></div><p className="mt-2 text-sm text-slate-600">Se añaden las instrucciones y obligaciones de cada fotografía que muestra el plan. Se mantienen en los reintentos.</p></details> : state.generationKind === 'product' ? <>
            <p className="text-sm font-semibold text-slate-900">{state.garments.length} objeto(s) × {state.productScenes.length} escena(s) = {totalJobs} imágenes · Solo fotos</p>
            {[...new Set(state.garments.map((item) => item.originalPhotos.length))].sort().map((references) => <ProviderCostEstimate key={references}
              config={state.providerImageConfigs[state.provider]} referenceCount={references}
              imageCount={state.garments.filter((item) => item.originalPhotos.length === references).length * state.productScenes.length} />)}
            <details className="rounded-2xl border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Ajustes avanzados · Instrucciones</summary>
              <div className="mt-4"><ProductPromptField value={state.prompt} scenes={state.productScenes} defaultPrompt={defaultProductPrompt} disabled={isSubmitting} onChange={onPromptChange} /></div>
            </details>
          </> : <>
            <ProviderCostEstimate config={state.providerImageConfigs[state.provider]} imageCount={totalJobs} referenceCount={2} />
            <details className="rounded-2xl border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Ajustes avanzados · Instrucciones</summary>
              <div className="mt-4"><TryOnPromptFields state={state} onPromptChange={onPromptChange} onBlocksChange={onPromptBlocksChange} sourceLabel={promptSourceLabel} /></div>
            </details>
          </>}

          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitDisabled}
            className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitButtonLabel}
          </button>
    </fieldset>
  );
};
