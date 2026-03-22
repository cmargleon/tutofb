import React, { useState } from 'react';
import { Batch, Job, Provider } from '../../../shared/src/types';
import { StatusBadge } from '../ui';
import { Download, RefreshCw, AlertCircle, History, Layers3 } from 'lucide-react';
import { useRole } from '../../features/auth/AuthProvider';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { downloadSingleJobImage } from '../../features/evaluation/downloadBatchImages';
import { useToast } from '../../features/feedback/FeedbackProvider';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import { useJobOutputHistory } from '../../features/evaluation/useJobOutputHistory';
import { HoverZoomImage } from './HoverZoomImage';

interface Props {
  batch: Batch;
  job: Job;
  index: number;
  draft: { provider: Provider; prompt: string };
  isQueueing: boolean;
  regenerationError: string | null;
  onUpdateDraft: (updates: Partial<{ provider: Provider; prompt: string }>) => void;
  onRegenerate: () => void;
  selected?: boolean;
  onToggleSelected?: () => void;
  focused?: boolean;
  onFocusTraceability?: () => void;
}

export const JobEvaluationCard: React.FC<Props> = ({
  batch,
  job,
  index,
  draft,
  isQueueing,
  regenerationError,
  onUpdateDraft,
  onRegenerate,
  selected = false,
  onToggleSelected,
  focused = false,
  onFocusTraceability,
}) => {
  const role = useRole();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const { url: imageUrl } = useStorageAssetUrl(job.currentOutput?.resultImagePath || null);
  const { previousOutput } = useJobOutputHistory(job.id);
  const { url: previousImageUrl } = useStorageAssetUrl(previousOutput?.resultImagePath || null);
  const isExperimentJob = job.experimentEnabled === true;

  const handleDownload = async () => {
    if (!job.currentOutput?.resultImagePath) return;
    setDownloading(true);
    try {
      await downloadSingleJobImage(batch, job, index);
    } catch (error) {
      console.error('Error downloading image:', error);
      toast({
        tone: 'error',
        title: 'No pudimos descargar la imagen',
        description: 'Revisa la conexión o inténtalo de nuevo desde esta tarjeta.',
      });
    } finally {
      setDownloading(false);
    }
  };

  const isProcessing = job.status === 'pending' || job.status === 'processing';
  const hasOutput = !!imageUrl;
  const hasPreviousOutput = !!previousOutput && !!previousImageUrl;

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white shadow-sm transition ${
        focused
          ? 'border-indigo-400 ring-2 ring-indigo-100'
          : selected
            ? 'border-sky-300 ring-2 ring-sky-100'
            : 'border-gray-200'
      } flex flex-col`}
      onClick={() => onFocusTraceability?.()}
      onFocusCapture={() => onFocusTraceability?.()}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
        <div className="flex items-start gap-3">
          {onToggleSelected ? (
            <label className="mt-0.5 inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelected}
                onClick={(event) => event.stopPropagation()}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                aria-label={`Seleccionar ${job.garmentName} pose ${index + 1}`}
              />
            </label>
          ) : null}
          <h3 className="font-semibold text-gray-900">Pose {index + 1}</h3>
          <div>
            <p className="text-xs text-gray-500">
              {job.modelNameSnapshot}
              {isExperimentJob ? ` · Brazo ${job.experimentArmLabel} (${job.provider})` : ''}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {job.garmentName} · {PROVIDER_LABELS[job.provider]}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onFocusTraceability ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onFocusTraceability();
              }}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                focused ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title="Abrir trazabilidad del job"
            >
              <History className="h-3.5 w-3.5" />
              Historial
            </button>
          ) : null}
          {hasPreviousOutput ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setCompareMode((current) => !current);
              }}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                compareMode ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title="Comparar resultado actual con la regeneración anterior"
            >
              {compareMode ? <Layers3 className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
              {compareMode ? 'Comparando' : 'Ver anterior'}
            </button>
          ) : null}
          <StatusBadge status={job.status} />
        </div>
      </div>

      {/* Image Area */}
      <div className="relative flex-shrink-0 bg-gray-100">
        {compareMode && hasPreviousOutput ? (
          <div className="grid grid-cols-2 gap-px bg-slate-200">
            <HoverZoomImage
              src={previousImageUrl!}
              alt={`Pose ${index + 1} anterior`}
              containerClassName="aspect-[3/4] bg-slate-100"
              imageClassName="object-cover"
              zoomScale={2.1}
            >
              <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                Regeneración anterior
              </span>
            </HoverZoomImage>
            <HoverZoomImage
              src={imageUrl!}
              alt={`Pose ${index + 1} actual`}
              containerClassName="aspect-[3/4] bg-slate-100"
              imageClassName="object-cover"
              zoomScale={2.1}
            >
              <span className="absolute left-3 top-3 rounded-full bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white">
                Resultado actual
              </span>
            </HoverZoomImage>
          </div>
        ) : hasOutput ? (
          <HoverZoomImage
            src={imageUrl!}
            alt={`Pose ${index + 1}`}
            containerClassName="aspect-[3/4]"
            imageClassName="object-cover"
            zoomScale={1.95}
          />
        ) : (
          <div className="aspect-[3/4] w-full flex flex-col items-center justify-center text-gray-400 p-6 text-center">
            {job.status === 'failed' ? (
              <>
                <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
                <p className="text-sm text-red-600">Error en la generación</p>
                {job.lastError && <p className="text-xs text-red-500 mt-1 line-clamp-2">{job.lastError}</p>}
              </>
            ) : (
              <p className="text-sm">Esperando resultado...</p>
            )}
          </div>
        )}

        {/* Processing Overlay */}
        {(isProcessing || isQueueing) && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
            <p className="font-medium text-gray-900">
              {isQueueing ? 'Encolando regeneración...' : 'Procesando imagen...'}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Esta tarjeta se actualizará automáticamente cuando termine el proceso.
            </p>
            {hasOutput && (
              <p className="text-xs text-indigo-600 font-medium mt-4 bg-indigo-50 px-3 py-1 rounded-full">
                Mostrando imagen anterior
              </p>
            )}
          </div>
        )}

        {/* Download Button */}
        {hasOutput && !isProcessing && !isQueueing && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              void handleDownload();
            }}
            disabled={downloading}
            className="absolute bottom-3 right-3 p-2 bg-white/90 hover:bg-white text-gray-700 rounded-full shadow-sm backdrop-blur transition-all disabled:opacity-50"
            title="Descargar imagen"
          >
            <Download className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Controls Area */}
      <div className="p-4 flex flex-col flex-grow space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Proveedor IA</label>
          <select
            value={draft.provider}
            onChange={(e) => onUpdateDraft({ provider: e.target.value as Provider })}
            onClick={(event) => event.stopPropagation()}
            disabled={isProcessing || isQueueing || !role.canRegenerate || isExperimentJob}
            className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-500"
          >
            <option value="fal-seedream">{PROVIDER_LABELS['fal-seedream']}</option>
            <option value="fal-banana-pro">{PROVIDER_LABELS['fal-banana-pro']}</option>
            <option value="openai-gpt-image-1.5">{PROVIDER_LABELS['openai-gpt-image-1.5']}</option>
          </select>
        </div>

        <div className="flex-grow flex flex-col">
          <label className="block text-xs font-medium text-gray-700 mb-1">Prompt</label>
          <textarea
            value={draft.prompt}
            onChange={(e) => onUpdateDraft({ prompt: e.target.value })}
            onClick={(event) => event.stopPropagation()}
            disabled={isProcessing || isQueueing || !role.canRegenerate || isExperimentJob}
            rows={4}
            className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 resize-none flex-grow disabled:bg-gray-50 disabled:text-gray-500"
            placeholder="Define el prompt base para regenerar..."
          />
          {isExperimentJob ? (
            <p className="mt-2 text-xs text-amber-700">
              El proveedor y el prompt quedan bloqueados para conservar la validez del experimento A/B.
            </p>
          ) : null}
        </div>

        {regenerationError && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
            {regenerationError}
          </div>
        )}

        {hasPreviousOutput ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Esta pose tiene historial de regeneración. Usa <span className="font-semibold">Ver anterior</span> para comparar el resultado vigente contra la salida previa.
          </div>
        ) : null}

        {role.canRegenerate ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRegenerate();
            }}
            disabled={isProcessing || isQueueing || !draft.prompt.trim()}
            className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isQueueing ? 'animate-spin' : ''}`} />
            Regenerar foto
          </button>
        ) : (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            Tu rol puede revisar y descargar resultados, pero no encolar regeneraciones.
          </div>
        )}
      </div>
    </div>
  );
};
