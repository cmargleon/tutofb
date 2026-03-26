import React, { useEffect, useMemo, useState } from 'react';
import { Batch, Job, JobOutput, Provider } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import { StatusBadge } from '../ui';
import { AlertCircle, ChevronDown, ChevronUp, Download, ImageIcon, RefreshCw, XCircle } from 'lucide-react';
import { useRole } from '../../features/auth/AuthProvider';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { downloadSingleJobImage } from '../../features/evaluation/downloadBatchImages';
import { useToast } from '../../features/feedback/FeedbackProvider';
import { useJobOutputHistory } from '../../features/evaluation/useJobOutputHistory';
import { toMillisOrZero as toMillis } from '../../../shared/src/utils/dateUtils';
import { HoverZoomImage } from './HoverZoomImage';
import { AttemptThumbnail } from './AttemptThumbnail';
import { AutoReviewPanel } from './AutoReviewPanel';
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

const isGeminiHighDemand = (error: string | null): boolean => {
  const msg = error?.toLowerCase() || '';
  return (
    msg.includes('high demand')
    || msg.includes('spikes in demand')
    || msg.includes('resource exhausted')
    || msg.includes('gemini está saturado')
    || msg.includes('gemini esta saturado')
  );
};

const ErrorRow: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
    <span>{message}</span>
  </div>
);

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
  const [detailsExpanded, setDetailsExpanded] = useState(false);
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
  const showManualGeminiRetry =
    job.status === 'failed'
    && Boolean(job.lastError)
    && isGeminiHighDemand(job.lastError || null)
    && role.canRegenerate
    && !isExperimentJob;

  const handleCancelGeneration = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await onCancelGeneration();
      toast({ tone: 'success', title: 'Generación cancelada', description: `La pose ${index + 1} dejó de procesarse.` });
    } catch (error) {
      console.error('Error cancelling generation:', error);
      toast({ tone: 'error', title: 'No pudimos cancelar esta generación', description: 'Inténtalo de nuevo en unos segundos.' });
    }
  };

  // Verdict badge text and color
  const verdictBadge = isUserApprovedDisplayed
    ? { label: '✓ Elegida', cls: 'bg-emerald-600/90 text-white' }
    : activeReview?.verdict === 'approved'
      ? { label: '✓ OK', cls: 'bg-emerald-600/90 text-white' }
      : activeReview?.verdict === 'rejected'
        ? { label: '↻ Reintento', cls: 'bg-amber-500/90 text-white' }
        : null;

  const controlsDisabled = isProcessing || isQueueing || isCancellingGeneration || isExperimentJob;

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow ${
        focused
          ? 'border-indigo-400 ring-2 ring-indigo-100'
          : selected
            ? 'border-sky-300 ring-2 ring-sky-100'
            : 'border-gray-200 hover:shadow-md'
      }`}
      onClick={() => onFocusTraceability?.()}
      onFocusCapture={() => onFocusTraceability?.()}
    >
      {/* Compact header */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2.5">
        {onToggleSelected ? (
          <label className="inline-flex cursor-pointer items-center">
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
        <span className="flex-1 text-sm font-semibold text-slate-800">Pose {index + 1}</span>
        <StatusBadge status={job.status} />
      </div>

      {/* Image area */}
      <div className="relative flex-shrink-0 bg-slate-100">
        {hasOutput ? (
          <HoverZoomImage
            src={displayedImageUrl!}
            alt={`Pose ${index + 1}`}
            containerClassName="aspect-[3/4]"
            imageClassName="bg-white object-contain"
            preserveNaturalAspectRatio
            zoomScale={1.95}
          >
            {/* Verdict badge overlay */}
            {verdictBadge && !isLoadingState ? (
              <span className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm ${verdictBadge.cls}`}>
                {verdictBadge.label}
              </span>
            ) : null}
            {!isViewingLatest ? (
              <span className="absolute left-2 top-2 rounded-lg bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-white">
                {formatOutputLabel(
                  displayedOutput!,
                  historyOutputs.findIndex((output) => output.id === displayedOutput?.id),
                )}
              </span>
            ) : null}
          </HoverZoomImage>
        ) : (
          <div className="flex aspect-[3/4] w-full flex-col items-center justify-center p-6 text-center text-gray-400">
            {job.status === 'failed' && !isLoadingState ? (
              <>
                <AlertCircle className="mb-2 h-8 w-8 text-red-400" />
                <p className="text-sm font-medium text-red-600">Error en la generación</p>
                {job.lastError ? <p className="mt-1 line-clamp-3 text-xs text-red-500">{job.lastError}</p> : null}
              </>
            ) : (
              <>
                <ImageIcon className="mb-2 h-8 w-8 text-slate-300" />
                <p className="text-sm text-gray-400">Esperando resultado...</p>
              </>
            )}
          </div>
        )}

        {/* Loading badge over existing image */}
        {showInlineLoadingBadge ? (
          <button
            type="button"
            onClick={(event) => void handleCancelGeneration(event)}
            disabled={!canCancelGeneration}
            className={`group absolute left-1/2 top-1/2 z-10 inline-flex -translate-x-1/2 -translate-y-1/2 items-center rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-all ${
              canCancelGeneration
                ? 'border-indigo-200 bg-white/92 text-indigo-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                : 'cursor-default border-indigo-200 bg-white/92 text-indigo-700'
            } ${isCancellingGeneration ? 'min-w-[140px] justify-center' : ''}`}
            title={canCancelGeneration ? 'Cancelar generación' : 'Generación en curso'}
          >
            <span className={`items-center gap-2 ${canCancelGeneration ? 'flex group-hover:hidden' : 'flex'}`}>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {isCancellingGeneration ? 'Cancelando...' : isQueueing ? 'Encolando...' : 'Generando...'}
            </span>
            {canCancelGeneration ? (
              <span className="hidden items-center gap-2 group-hover:flex">
                <XCircle className="h-3.5 w-3.5" />
                Cancelar
              </span>
            ) : null}
          </button>
        ) : null}

        {/* Loading placeholder (no image yet) */}
        {showLoadingPlaceholder ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 p-6 text-center backdrop-blur-sm">
            <RefreshCw className="mb-4 h-8 w-8 animate-spin text-indigo-600" />
            <p className="font-medium text-gray-900">{isQueueing ? 'Encolando...' : 'Procesando...'}</p>
            <button
              type="button"
              onClick={(event) => void handleCancelGeneration(event)}
              disabled={!canCancelGeneration}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 shadow-sm transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-default disabled:opacity-60"
            >
              <XCircle className="h-3.5 w-3.5" />
              {isCancellingGeneration ? 'Cancelando...' : 'Cancelar'}
            </button>
          </div>
        ) : null}

        {/* Download button */}
        {hasOutput && !isLoadingState ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              void handleDownload();
            }}
            disabled={downloading}
            className="absolute bottom-2 right-2 rounded-xl bg-white/90 p-2 text-gray-700 shadow-sm backdrop-blur transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Descargar imagen"
          >
            <Download className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* History thumbnails — only when multiple attempts exist */}
      {historyOutputs.length > 1 ? (
        <div
          className="flex gap-2 overflow-x-auto border-t border-slate-100 px-3 py-2"
          onClick={(event) => event.stopPropagation()}
        >
          {historyOutputs.map((output, outputIndex) => (
            <AttemptThumbnail
              key={output.id}
              output={output}
              label={formatOutputLabel(output, outputIndex)}
              active={displayedOutput?.id === output.id}
              userApproved={selectedOutputId === output.id}
              onSelect={() => onSelectOutput?.(output.id, output)}
            />
          ))}
        </div>
      ) : null}

      {/* Action strip */}
      <div className="space-y-2 border-t border-slate-100 px-3 py-3">
        {/* Primary: Regenerate */}
        {role.canRegenerate ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRegenerate();
            }}
            disabled={isProcessing || isQueueing || isCancellingGeneration || !draft.prompt.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isQueueing ? 'animate-spin' : ''}`} />
            {isQueueing ? 'Regenerando...' : 'Regenerar foto'}
          </button>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">
            Solo lectura — no podés encolar regeneraciones
          </div>
        )}

        {/* Details toggle */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setDetailsExpanded((current) => !current);
          }}
          className="flex w-full items-center justify-between px-1 py-1 text-xs text-slate-500 transition-colors hover:text-slate-800"
        >
          <span>Revisión y prompt</span>
          {detailsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* Expanded details */}
        {detailsExpanded ? (
          <div className="space-y-3 border-t border-slate-100 pt-3" onClick={(event) => event.stopPropagation()}>
            <AutoReviewPanel
              key={job.id}
              displayedOutput={displayedOutput}
              activeReview={activeReview}
              activeReviewPrompt={activeReviewPrompt}
              isUserApprovedDisplayed={isUserApprovedDisplayed}
              reviewSignals={reviewSignals}
            />

            {/* Provider select */}
            {role.canRegenerate ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Proveedor IA</label>
                <select
                  value={draft.provider}
                  onChange={(event) => onUpdateDraft({ provider: event.target.value as Provider })}
                  disabled={controlsDisabled}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="fal-seedream">{PROVIDER_LABELS['fal-seedream']}</option>
                  <option value="fal-banana-pro">{PROVIDER_LABELS['fal-banana-pro']}</option>
                  <option value="openai-gpt-image-1.5">{PROVIDER_LABELS['openai-gpt-image-1.5']}</option>
                </select>
              </div>
            ) : null}

            {/* Prompt textarea */}
            {role.canRegenerate ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Prompt</label>
                <textarea
                  value={draft.prompt}
                  onChange={(event) => onUpdateDraft({ prompt: event.target.value })}
                  disabled={controlsDisabled}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                  placeholder="Prompt base para regenerar..."
                />
                {isExperimentJob ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Bloqueado por experimento A/B.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Manual Gemini retry */}
            {showManualGeminiRetry ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetryAutoReview();
                }}
                disabled={isProcessing || isQueueing || isCancellingGeneration || isRetryingAutoReview}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRetryingAutoReview ? 'animate-spin' : ''}`} />
                {isRetryingAutoReview ? 'Revisando...' : 'Revisar con Gemini'}
              </button>
            ) : null}

            {/* Failed error */}
            {job.status === 'failed' && job.lastError ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                <span>{job.lastError}</span>
              </div>
            ) : null}

            {regenerationError ? <ErrorRow message={regenerationError} /> : null}
            {autoReviewRetryError ? <ErrorRow message={autoReviewRetryError} /> : null}
            {cancellationError ? <ErrorRow message={cancellationError} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};
