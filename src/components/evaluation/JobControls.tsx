import React from 'react';
import { Job, JobOutput, Provider } from '../../../shared/src/types';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import { AlertCircle, RefreshCw, XCircle } from 'lucide-react';

const INPUT_BASE =
  'w-full rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed';

interface Props {
  draft: { provider: Provider; prompt: string };
  isProcessing: boolean;
  isQueueing: boolean;
  isCancelling: boolean;
  canRegenerate: boolean;
  isExperimentJob: boolean;
  jobStatus: Job['status'];
  lastError: string | null;
  currentOutput: JobOutput | null;
  regenerationError: string | null;
  cancellationError: string | null;
  historyOutputsCount: number;
  onUpdateDraft: (updates: Partial<{ provider: Provider; prompt: string }>) => void;
  onRegenerate: () => void;
}

export const JobControls: React.FC<Props> = ({
  draft,
  isProcessing,
  isQueueing,
  isCancelling,
  canRegenerate,
  isExperimentJob,
  jobStatus,
  lastError,
  currentOutput,
  regenerationError,
  cancellationError,
  historyOutputsCount,
  onUpdateDraft,
  onRegenerate,
}) => {
  const disabled = isProcessing || isQueueing || isCancelling || !canRegenerate || isExperimentJob;

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Proveedor IA</label>
        <select
          value={draft.provider}
          onChange={(e) => onUpdateDraft({ provider: e.target.value as Provider })}
          onClick={(event) => event.stopPropagation()}
          disabled={disabled}
          className={INPUT_BASE}
        >
          <option value="fal-seedream">{PROVIDER_LABELS['fal-seedream']}</option>
          <option value="fal-banana-pro">{PROVIDER_LABELS['fal-banana-pro']}</option>
          <option value="openai-gpt-image-1.5">{PROVIDER_LABELS['openai-gpt-image-1.5']}</option>
        </select>
      </div>

      <div className="flex-grow flex flex-col">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Prompt</label>
        <textarea
          value={draft.prompt}
          onChange={(e) => onUpdateDraft({ prompt: e.target.value })}
          onClick={(event) => event.stopPropagation()}
          disabled={disabled}
          rows={4}
          className={`${INPUT_BASE} resize-none flex-grow`}
          placeholder="Define el prompt base para regenerar..."
        />
        {isExperimentJob ? (
          <p className="mt-1.5 text-xs text-amber-700">
            El proveedor y el prompt quedan bloqueados para conservar la validez del experimento A/B.
          </p>
        ) : null}
      </div>

      {jobStatus === 'failed' && lastError && currentOutput ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
          <div>
            <span className="font-medium">Detalle del fallo: </span>
            {lastError}
          </div>
        </div>
      ) : null}

      {regenerationError ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" aria-hidden="true" />
          <span>{regenerationError}</span>
        </div>
      ) : null}

      {cancellationError ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" aria-hidden="true" />
          <span>{cancellationError}</span>
        </div>
      ) : null}

      {historyOutputsCount > 1 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Esta pose conserva el historial completo de intentos generados. Puedes abrir cualquier miniatura para revisar
          qué cambió.
        </div>
      ) : null}

      {canRegenerate ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onRegenerate();
          }}
          disabled={isProcessing || isQueueing || isCancelling || !draft.prompt.trim()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-transparent text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${isQueueing ? 'animate-spin' : ''}`} />
          Regenerar foto
        </button>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
          Tu rol puede revisar y descargar resultados, pero no encolar regeneraciones.
        </div>
      )}
    </>
  );
};
