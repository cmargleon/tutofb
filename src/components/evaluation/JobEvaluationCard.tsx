import React, { useEffect, useMemo, useState } from 'react';
import { Batch, Job, JobOutput, Provider } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { StatusBadge } from '../ui';
import { AlertCircle, Download, ImageIcon, RefreshCw, XCircle } from 'lucide-react';
import { useRole } from '../../features/auth/AuthProvider';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { downloadSingleJobImage } from '../../features/evaluation/downloadBatchImages';
import { useToast } from '../../features/feedback/FeedbackProvider';
import { useJobOutputHistory } from '../../features/evaluation/useJobOutputHistory';
import { toMillisOrZero as toMillis } from '../../../shared/src/utils/dateUtils';
import { HoverZoomImage } from './HoverZoomImage';
import { AttemptThumbnail } from './AttemptThumbnail';
import { AutoReviewPanel } from './AutoReviewPanel';
import { JobControls } from './JobControls';
import { getJobReviewSignals } from '../../../shared/src/reviewMetrics';

interface Props {
  batch: Batch;
  job: Job;
  index: number;
  draft: { provider: Provider; prompt: string };
  isQueueing: boolean;
  isRetryingAutoReview: boolean;
  isCancellingGeneration: boolean;
  regenerationError: string | null;
  autoReviewRetryError: string | null;
  cancellationError: string | null;
  onUpdateDraft: (updates: Partial<{ provider: Provider; prompt: string }>) => void;
  onRegenerate: () => void;
  onRetryAutoReview: () => void;
  onCancelGeneration: () => Promise<void>;
  selected?: boolean;
  onToggleSelected?: () => void;
  focused?: boolean;
  onFocusTraceability?: () => void;
  selectedOutputId?: string | null;
  onSelectOutput?: (outputId: string | null, output: JobOutput | null) => void;
}

const HISTORY_LIMIT = 18;

const formatOutputLabel = (output: JobOutput, fallbackIndex: number): string =>
  output.generationAttempt ? `Intento ${output.generationAttempt}` : `Salida ${fallbackIndex + 1}`;

export const JobEvaluationCard: React.FC<Props> = ({
  batch,
  job,
  index,
  draft,
  isQueueing,
  isRetryingAutoReview,
  isCancellingGeneration,
  regenerationError,
  autoReviewRetryError,
  cancellationError,
  onUpdateDraft,
  onRegenerate,
  onRetryAutoReview,
  onCancelGeneration,
  selected = false,
  onToggleSelected,
  focused = false,
  onFocusTraceability,
  selectedOutputId = null,
  onSelectOutput,
}) => {
  const role = useRole();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const { outputs } = useJobOutputHistory(job.id, HISTORY_LIMIT);
  const isExperimentJob = job.experimentEnabled === true;

  const outputsDesc = useMemo(() => {
    const merged = new Map<string, JobOutput>();
    [job.userSelectedOutput, job.currentOutput, ...outputs].forEach((output) => {
      if (output?.id && !merged.has(output.id)) {
        merged.set(output.id, output);
      }
    });
    return [...merged.values()].sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
  }, [job.currentOutput, job.userSelectedOutput, outputs]);

  const currentOutput = job.currentOutput || outputsDesc[0] || null;
  const reviewSignals = getJobReviewSignals(job);
  const displayedOutput = useMemo(
    () => outputsDesc.find((output) => output.id === selectedOutputId) || currentOutput,
    [currentOutput, outputsDesc, selectedOutputId],
  );
  const historyOutputs = useMemo(() => [...outputsDesc].reverse(), [outputsDesc]);
  const isViewingLatest = displayedOutput?.id === currentOutput?.id;
  const isUserApprovedDisplayed = Boolean(displayedOutput?.id && selectedOutputId === displayedOutput.id);
  const activeReview =
    displayedOutput?.autoReview || (isViewingLatest ? job.latestAutoReview || currentOutput?.autoReview || null : null);
  const activeReviewPrompt =
    activeReview?.reviewPrompt ||
    displayedOutput?.autoReview?.reviewPrompt ||
    currentOutput?.autoReview?.reviewPrompt ||
    job.latestAutoReview?.reviewPrompt ||
    null;

  const { url: displayedImageUrl } = useStorageAssetUrl(displayedOutput?.resultImagePath || null);
  const { url: poseThumbnailUrl } = useStorageAssetUrl(job.poseImagePath || null);

  useEffect(() => {
    if (selectedOutputId && !outputsDesc.some((output) => output.id === selectedOutputId)) {
      onSelectOutput?.(null, null);
    }
  }, [onSelectOutput, outputsDesc, selectedOutputId]);

  const handleDownload = async () => {
    const effectiveOutput = selectedOutputId
      ? outputsDesc.find((output) => output.id === selectedOutputId) || null
      : resolveApprovedJobOutput(job);
    if (!effectiveOutput?.resultImagePath) return;
    setDownloading(true);
    try {
      await downloadSingleJobImage(batch, job, index, selectedOutputId);
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
  const isLoadingState = isProcessing || isQueueing;
  const hasOutput = !!displayedImageUrl;
  const canCancelGeneration = role.canRegenerate && isLoadingState && !isCancellingGeneration;
  const showInlineLoadingBadge = hasOutput && isLoadingState && isViewingLatest;
  const showLoadingPlaceholder = !hasOutput && isLoadingState;

  const handleCancelGeneration = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    try {
      await onCancelGeneration();
      toast({
        tone: 'success',
        title: 'Generación cancelada',
        description: `La pose ${index + 1} dejó de procesarse.`,
      });
    } catch (error) {
      console.error('Error cancelling generation:', error);
      toast({
        tone: 'error',
        title: 'No pudimos cancelar esta generación',
        description: 'Inténtalo de nuevo en unos segundos.',
      });
    }
  };

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow flex flex-col ${
        focused
          ? 'border-indigo-400 ring-2 ring-indigo-100'
          : selected
            ? 'border-sky-300 ring-2 ring-sky-100'
            : 'border-gray-200 hover:shadow-md'
      }`}
      onClick={() => onFocusTraceability?.()}
      onFocusCapture={() => onFocusTraceability?.()}
    >
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
          <div className="flex items-start gap-3">
            <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
              {poseThumbnailUrl ? (
                <img
                  src={poseThumbnailUrl}
                  alt={job.poseFileName || `Pose ${index + 1}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-300">
                  <ImageIcon className="h-4 w-4" />
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Pose {index + 1}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
        </div>
      </div>

      <div className="relative flex-shrink-0 bg-gray-100">
        {hasOutput ? (
          <HoverZoomImage
            src={displayedImageUrl!}
            alt={`Pose ${index + 1}`}
            containerClassName="aspect-[3/4]"
            imageClassName="bg-white object-contain"
            preserveNaturalAspectRatio
            zoomScale={1.95}
          >
            {!isViewingLatest ? (
              <span className="absolute left-3 top-3 rounded-lg bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-white">
                {formatOutputLabel(
                  displayedOutput!,
                  historyOutputs.findIndex((output) => output.id === displayedOutput?.id),
                )}
              </span>
            ) : null}
          </HoverZoomImage>
        ) : (
          <div className="aspect-[3/4] w-full flex flex-col items-center justify-center text-gray-400 p-6 text-center">
            {job.status === 'failed' && !isLoadingState ? (
              <>
                <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
                <p className="text-sm font-medium text-red-600">Error en la generación</p>
                {job.lastError && <p className="text-xs text-red-500 mt-1">{job.lastError}</p>}
              </>
            ) : (
              <p className="text-sm text-gray-400">Esperando resultado...</p>
            )}
          </div>
        )}

        {showInlineLoadingBadge ? (
          <button
            type="button"
            onClick={(event) => void handleCancelGeneration(event)}
            disabled={!canCancelGeneration}
            className={`group absolute left-1/2 top-1/2 z-10 inline-flex -translate-x-1/2 -translate-y-1/2 items-center rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-all ${
              canCancelGeneration
                ? 'border-indigo-200 bg-white/92 text-indigo-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                : 'cursor-default border-indigo-200 bg-white/92 text-indigo-700'
            } ${isCancellingGeneration ? 'min-w-[164px] justify-center' : ''}`}
            title={canCancelGeneration ? 'Cancelar generación de esta pose' : 'Generación en curso'}
          >
            <span className={`items-center gap-2 ${canCancelGeneration ? 'flex group-hover:hidden' : 'flex'}`}>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {isCancellingGeneration ? 'Cancelando...' : isQueueing ? 'Encolando...' : 'Generando...'}
            </span>
            {canCancelGeneration ? (
              <span className="hidden items-center gap-2 group-hover:flex">
                <XCircle className="h-3.5 w-3.5" />
                Cancelar esta pose
              </span>
            ) : null}
          </button>
        ) : null}

        {showLoadingPlaceholder ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 p-6 text-center backdrop-blur-sm">
            <RefreshCw className="mb-4 h-8 w-8 animate-spin text-indigo-600" />
            <p className="font-medium text-gray-900">{isQueueing ? 'Encolando regeneración...' : 'Procesando imagen...'}</p>
            <p className="mt-2 text-xs text-gray-500">Esta tarjeta se actualizará automáticamente cuando termine.</p>
            <button
              type="button"
              onClick={(event) => void handleCancelGeneration(event)}
              disabled={!canCancelGeneration}
              className={`group mt-4 inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-all ${
                canCancelGeneration
                  ? 'border-indigo-200 bg-white text-indigo-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                  : 'cursor-default border-indigo-200 bg-white text-indigo-700'
              }`}
              title={canCancelGeneration ? 'Cancelar generación de esta pose' : 'Generación en curso'}
            >
              <span className={`items-center gap-2 ${canCancelGeneration ? 'flex group-hover:hidden' : 'flex'}`}>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                {isCancellingGeneration ? 'Cancelando...' : 'Cargando...'}
              </span>
              {canCancelGeneration ? (
                <span className="hidden items-center gap-2 group-hover:flex">
                  <XCircle className="h-3.5 w-3.5" />
                  Cancelar esta pose
                </span>
              ) : null}
            </button>
            {currentOutput ? (
              <p className="mt-4 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                Mostrando el último intento disponible
              </p>
            ) : null}
          </div>
        ) : null}

        {hasOutput && !isLoadingState && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              void handleDownload();
            }}
            disabled={downloading}
            className="absolute bottom-3 right-3 cursor-pointer p-2 bg-white/90 hover:bg-white text-gray-700 rounded-xl shadow-sm backdrop-blur transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="Descargar imagen aprobada"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="border-t border-slate-100 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Historial generado</p>
            <p className="mt-1 text-xs text-slate-500">
              {historyOutputs.length === 0
                ? 'Todavía no hay imágenes generadas para esta pose.'
                : `${historyOutputs.length} intento${historyOutputs.length === 1 ? '' : 's'} disponible${historyOutputs.length === 1 ? '' : 's'} en esta imagen.`}
            </p>
          </div>
          {historyOutputs.length > 0 ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {formatOutputLabel(currentOutput!, historyOutputs.length - 1)}
            </span>
          ) : null}
        </div>

        {historyOutputs.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" onClick={(event) => event.stopPropagation()}>
            {historyOutputs.map((output, outputIndex) => (
              <AttemptThumbnail
                key={output.id}
                output={output}
                label={formatOutputLabel(output, outputIndex)}
                active={displayedOutput?.id === output.id}
                userApproved={selectedOutputId === output.id}
                onSelect={() => {
                  onSelectOutput?.(output.id, output);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="p-4 flex flex-col flex-grow space-y-3">
        <AutoReviewPanel
          key={job.id}
          displayedOutput={displayedOutput}
          activeReview={activeReview}
          activeReviewPrompt={activeReviewPrompt}
          isUserApprovedDisplayed={isUserApprovedDisplayed}
          reviewSignals={reviewSignals}
        />

        <JobControls
          draft={draft}
          isProcessing={isProcessing}
          isQueueing={isQueueing}
          isRetryingAutoReview={isRetryingAutoReview}
          isCancelling={isCancellingGeneration}
          canRegenerate={role.canRegenerate}
          isExperimentJob={isExperimentJob}
          jobStatus={job.status}
          lastError={job.lastError || null}
          currentOutput={currentOutput}
          regenerationError={regenerationError}
          autoReviewRetryError={autoReviewRetryError}
          cancellationError={cancellationError}
          historyOutputsCount={historyOutputs.length}
          onUpdateDraft={onUpdateDraft}
          onRegenerate={onRegenerate}
          onRetryAutoReview={onRetryAutoReview}
        />
      </div>
    </div>
  );
};
