import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { AlertCircle, ChevronLeft, ChevronRight, Copy, Download, Loader2, RefreshCw, X } from 'lucide-react';
import { Batch, Job, JobOutput, Provider } from '../../../shared/src/types';
import { PROVIDER_LABELS, PROVIDER_VALUES, resolveApprovedJobOutput } from '../../../shared/src/domain';
import { toMillisOrZero as toMillis } from '../../../shared/src/utils/dateUtils';
import { useJobOutputHistory } from '../../features/evaluation/useJobOutputHistory';
import { selectJobOutput } from '../../features/evaluation/firebase';
import { useJobRegenerationFirebase } from '../../features/evaluation/useJobRegenerationFirebase';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { useRole } from '../../features/auth/AuthProvider';
import { useToast } from '../../features/feedback/FeedbackProvider';
import {
  getCatalogJobErrorMessage,
  getCatalogJobFailureFacts,
  getCatalogJobFailureTechnicalMessage,
  getCatalogJobFailureTitle,
  getJobFailureInfo,
  getOutputFailureInfo,
  isFailureCancellation,
} from '../../features/catalog/errorMessage';
import { db } from '../../firebase';
import { AttemptThumbnail } from '../evaluation/AttemptThumbnail';
import { HoverZoomImage } from '../evaluation/HoverZoomImage';
import { CatalogGarmentThumbnailFloat } from './CatalogGarmentThumbnailFloat';
import { CatalogProductDraftPanel } from './CatalogProductDraftPanel';
import FileSaver from 'file-saver';

const HISTORY_LIMIT = 18;

const formatOutputLabel = (output: JobOutput, fallbackIndex: number): string =>
  output.generationAttempt ? `Intento ${output.generationAttempt}` : `Salida ${fallbackIndex + 1}`;

interface CatalogLightboxProps {
  job: Job;
  disabledProviders?: string[];
  canGoPrevious: boolean;
  canGoNext: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

export const CatalogLightbox: React.FC<CatalogLightboxProps> = ({
  job,
  disabledProviders,
  canGoPrevious,
  canGoNext,
  onClose,
  onPrevious,
  onNext,
}) => {
  const role = useRole();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [pendingSelectedOutputId, setPendingSelectedOutputId] = useState<string | null | undefined>(undefined);
  const [selectionSavingOutputId, setSelectionSavingOutputId] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [showPendingHistoryPlaceholder, setShowPendingHistoryPlaceholder] = useState(false);
  const [regenerationInFlight, setRegenerationInFlight] = useState(false);
  const [regenerationSawRemoteProcessing, setRegenerationSawRemoteProcessing] = useState(false);
  const pendingHistoryBaselineIdsRef = useRef<Set<string> | null>(null);
  const { outputs, loading: historyLoading } = useJobOutputHistory(job.id, HISTORY_LIMIT);
  const {
    localDrafts,
    queueingJobs,
    regenerationErrors,
    initializeDraft,
    updateDraft,
    handleRegenerate,
  } = useJobRegenerationFirebase();

  useEffect(() => {
    if (job.id) {
      initializeDraft(job);
    }
  }, [initializeDraft, job]);

  useEffect(() => {
    setPendingSelectedOutputId(undefined);
    setSelectionSavingOutputId(null);
    setShowPendingHistoryPlaceholder(false);
    setRegenerationInFlight(false);
    setRegenerationSawRemoteProcessing(false);
    pendingHistoryBaselineIdsRef.current = null;
  }, [job.id]);

  useEffect(() => {
    if (!job.batchId) {
      setBatch(null);
      return undefined;
    }

    const batchRef = doc(db, 'batches', job.batchId);
    return onSnapshot(
      batchRef,
      (docSnap) => {
        if (!docSnap.exists()) {
          setBatch(null);
          return;
        }

        setBatch({ id: docSnap.id, ...docSnap.data() } as Batch);
      },
      (error) => {
        console.error('Error loading batch for catalog lightbox layout:', error);
        setBatch(null);
      },
    );
  }, [job.batchId]);

  const outputsDesc = useMemo(() => {
    const merged = new Map<string, JobOutput>();
    [job.userSelectedOutput, job.currentOutput, ...outputs].forEach((output) => {
      if (output?.id && !merged.has(output.id)) {
        merged.set(output.id, output);
      }
    });
    return [...merged.values()].sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
  }, [job.currentOutput, job.userSelectedOutput, outputs]);

  const persistedSelectedOutputId = resolveApprovedJobOutput(job)?.id || null;
  const effectiveSelectedOutputId =
    pendingSelectedOutputId !== undefined ? pendingSelectedOutputId : persistedSelectedOutputId;
  const currentOutput = resolveApprovedJobOutput(job) || outputsDesc[0] || null;
  const historyOutputs = useMemo(() => [...outputsDesc].reverse(), [outputsDesc]);
  const displayedOutput = useMemo(
    () => outputsDesc.find((output) => output.id === effectiveSelectedOutputId) || currentOutput,
    [currentOutput, effectiveSelectedOutputId, outputsDesc],
  );
  const displayedOutputLabel = displayedOutput
    ? formatOutputLabel(
      displayedOutput,
      historyOutputs.findIndex((output) => output.id === displayedOutput.id),
    )
    : null;
  const { url: displayedImageUrl, loading: displayedImageLoading } = useStorageAssetUrl(
    displayedOutput?.resultImagePath || resolveApprovedJobOutput(job)?.resultImagePath || null,
  );
  const draft = job.id
    ? (localDrafts[job.id] ?? { provider: job.provider, prompt: job.promptBase || job.finalPrompt || '' })
    : { provider: job.provider, prompt: job.promptBase || job.finalPrompt || '' };
  const isQueueing = job.id ? Boolean(queueingJobs[job.id]) : false;
  const regenerationError = job.id ? regenerationErrors[job.id] || null : null;
  const isRemoteGenerating = job.status === 'pending' || job.status === 'processing';
  const isRegenerationActive = isQueueing || regenerationInFlight || isRemoteGenerating;
  const selectedProviderDisabled = Boolean(disabledProviders?.includes(draft.provider));
  const controlsDisabled = !role.canRegenerate || !job.id || isRegenerationActive;
  const displayedImageValue = displayedImageUrl || displayedOutput?.resultImagePath || null;
  const isGeneratingJob = isRemoteGenerating;
  const showSpreadsheetPanel = batch?.outputMode !== 'photos_only';
  const displayedOutputFailure = useMemo(() => getOutputFailureInfo(displayedOutput), [displayedOutput]);
  const displayedFailureInfo = useMemo(() => {
    if (displayedOutputFailure) {
      return displayedOutputFailure;
    }

    if (!displayedOutput || displayedOutput.id === job.currentOutput?.id) {
      return getJobFailureInfo(job, displayedOutput || null);
    }

    return null;
  }, [displayedOutput, displayedOutputFailure, job]);
  const failedJobMessage = displayedFailureInfo
    ? getCatalogJobErrorMessage(job, displayedOutput || null)
    : getCatalogJobErrorMessage(job);
  const failedJobTitle = displayedFailureInfo
    ? getCatalogJobFailureTitle(job, displayedOutput || null)
    : getCatalogJobFailureTitle(job);
  const failedJobTechnicalMessage = displayedFailureInfo
    ? getCatalogJobFailureTechnicalMessage(job, displayedOutput || null)
    : getCatalogJobFailureTechnicalMessage(job);
  const failedJobFacts = getCatalogJobFailureFacts(displayedFailureInfo);
  const failedJobIsCancellation = isFailureCancellation(displayedFailureInfo);

  useEffect(() => {
    if (pendingSelectedOutputId === undefined) {
      return;
    }

    if (pendingSelectedOutputId === persistedSelectedOutputId) {
      setPendingSelectedOutputId(undefined);
      setSelectionSavingOutputId(null);
    }
  }, [pendingSelectedOutputId, persistedSelectedOutputId]);

  useEffect(() => {
    if (!regenerationInFlight) {
      return;
    }

    if (isQueueing || isRemoteGenerating) {
      setRegenerationSawRemoteProcessing(true);
    }
  }, [isQueueing, isRemoteGenerating, regenerationInFlight]);

  useEffect(() => {
    if (!showPendingHistoryPlaceholder && !regenerationInFlight) {
      return;
    }

    const baselineIds = pendingHistoryBaselineIdsRef.current;
    const hasNewOutput = Boolean(
      baselineIds
      && outputsDesc.some((output) => output.id && !baselineIds.has(output.id)),
    );
    const generationFinished = regenerationSawRemoteProcessing && !isQueueing && !isRemoteGenerating;

    if (hasNewOutput || generationFinished) {
      setShowPendingHistoryPlaceholder(false);
      setRegenerationInFlight(false);
      setRegenerationSawRemoteProcessing(false);
      pendingHistoryBaselineIdsRef.current = null;
    }
  }, [
    isQueueing,
    isRemoteGenerating,
    outputsDesc,
    regenerationInFlight,
    regenerationSawRemoteProcessing,
    showPendingHistoryPlaceholder,
  ]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingTarget = target
        ? ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
        : false;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (isTypingTarget) return;

      if (e.key === 'ArrowLeft') {
        if (!canGoPrevious) return;
        e.preventDefault();
        onPrevious();
        return;
      }

      if (e.key === 'ArrowRight') {
        if (!canGoNext) return;
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canGoNext, canGoPrevious, onClose, onNext, onPrevious]);

  const handleDownload = async () => {
    if (!displayedImageUrl) return;
    setDownloading(true);
    try {
      const resp = await fetch(displayedImageUrl);
      const blob = await resp.blob();
      const ext = displayedOutput?.resultImagePath?.split('?')[0].split('.').pop() || 'png';
      const filename = [
        job.clientNameSnapshot,
        job.garmentName,
        job.modelNameSnapshot,
        job.id,
      ]
        .map((s) => (s || '').replace(/[^a-zA-Z0-9_-]/g, '_'))
        .join('_') + `.${ext}`;
      FileSaver.saveAs(blob, filename);
    } finally {
      setDownloading(false);
    }
  };

  const handleRegenerateClick = async () => {
    if (!job.id || selectedProviderDisabled) return;
    const success = await handleRegenerate(job.id);
    if (success) {
      pendingHistoryBaselineIdsRef.current = new Set(outputsDesc.map((output) => output.id));
      setShowPendingHistoryPlaceholder(true);
      setRegenerationInFlight(true);
      setRegenerationSawRemoteProcessing(false);
      toast({
        tone: 'success',
        title: 'Regeneración encolada',
        description: `La foto de ${job.modelNameSnapshot} volvió a cola con el prompt actualizado.`,
      });
    }
  };

  const handleCopyImageUrl = async () => {
    if (!displayedImageValue) return;
    try {
      await navigator.clipboard.writeText(displayedImageValue);
      toast({ tone: 'success', title: 'URL copiada' });
    } catch (error) {
      console.error('Failed to copy image URL:', error);
      toast({ tone: 'error', title: 'No pudimos copiar la URL' });
    }
  };

  const handleSelectHistoryOutput = async (outputId: string) => {
    if (!job.id || selectionSavingOutputId) {
      return;
    }

    if (effectiveSelectedOutputId === outputId && pendingSelectedOutputId === undefined) {
      return;
    }

    const previousPending = pendingSelectedOutputId;
    setPendingSelectedOutputId(outputId);
    setSelectionSavingOutputId(outputId);

    try {
      await selectJobOutput(job.id, outputId);
    } catch (error: any) {
      console.error('Failed to persist catalog history selection:', error);
      setPendingSelectedOutputId(previousPending);
      setSelectionSavingOutputId(null);
      toast({
        tone: 'error',
        title: 'No pudimos guardar esta selección',
        description: error?.message || 'Inténtalo de nuevo en unos segundos.',
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="relative flex h-full max-h-[92vh] w-full max-w-[96rem] flex-col overflow-hidden text-white">
        <div
          className="absolute right-4 top-4 z-30 flex flex-col gap-2 sm:right-5 sm:top-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 self-start">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || !displayedImageUrl}
              className="inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/35 text-white shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-md transition hover:bg-black/55 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Descargar imagen"
              title="Descargar imagen"
            >
              {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/35 text-white/80 shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-md transition hover:bg-black/55 hover:text-white"
              aria-label="Cerrar modal"
              title="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className={`grid min-h-0 flex-1 ${showSpreadsheetPanel ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          <div className="relative flex min-h-[20rem] min-w-0 items-center justify-center overflow-hidden border-b border-white/10 p-4 pt-20 sm:p-6 sm:pt-24 lg:border-b-0 lg:border-r lg:border-white/10 lg:p-8 lg:pt-24">
            {canGoPrevious ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPrevious(); }}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/10 bg-black/35 p-2 text-white transition hover:bg-black/55"
                aria-label="Imagen anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            ) : null}

            {canGoNext ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNext(); }}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/10 bg-black/35 p-2 text-white transition hover:bg-black/55"
                aria-label="Imagen siguiente"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : null}

            {displayedOutputLabel ? (
              <div
                className="absolute left-4 top-20 z-10 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur sm:top-24"
                onClick={(e) => e.stopPropagation()}
              >
                {displayedOutputLabel}
              </div>
            ) : null}

            <CatalogGarmentThumbnailFloat job={job} />

            <div className="flex h-full min-h-0 w-full min-w-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
              {displayedImageUrl ? (
                <div className="relative flex h-full w-full items-center justify-center">
                  <HoverZoomImage
                    src={displayedImageUrl}
                    alt={job.garmentName}
                    containerClassName="flex h-full w-full items-center justify-center"
                    imageClassName="max-h-full max-w-full object-contain"
                    preserveNaturalAspectRatio
                  />
                  {displayedFailureInfo ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/85 via-black/55 to-transparent px-4 pb-4 pt-20">
                      <div
                        className={`pointer-events-auto w-full max-w-3xl rounded-2xl border px-4 py-3 text-left shadow-2xl backdrop-blur ${
                          failedJobIsCancellation
                            ? 'border-amber-400/30 bg-amber-500/10 text-amber-50'
                            : 'border-rose-400/30 bg-rose-500/10 text-rose-50'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">
                            {failedJobTitle || (failedJobIsCancellation ? 'Generacion cancelada' : 'La generacion fallo')}
                          </p>
                          {failedJobFacts.map((fact) => (
                            <span
                              key={`${fact.label}-${fact.value}`}
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                failedJobIsCancellation
                                  ? 'border-amber-200/35 bg-amber-400/10 text-amber-50'
                                  : 'border-rose-200/35 bg-rose-400/10 text-rose-50'
                              }`}
                            >
                              {fact.label}: {fact.value}
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 text-sm leading-6">
                          {failedJobMessage || 'No encontramos detalle adicional del error para esta imagen.'}
                        </p>
                        {failedJobTechnicalMessage ? (
                          <p className={`mt-2 text-xs leading-5 ${failedJobIsCancellation ? 'text-amber-100/90' : 'text-rose-100/90'}`}>
                            {failedJobTechnicalMessage}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full min-h-[22rem] w-full items-center justify-center border border-dashed border-white/15 text-slate-300">
                  {displayedImageLoading || isGeneratingJob ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isGeneratingJob ? 'La imagen todavía se está generando.' : 'Cargando imagen...'}
                    </div>
                  ) : (displayedFailureInfo || job.status === 'failed') ? (
                    <div className="flex w-full max-w-full items-center justify-center overflow-hidden px-6">
                      <div className="flex w-full max-w-xl min-w-0 flex-col items-center gap-3 text-center">
                        <AlertCircle className="h-8 w-8 text-rose-300" />
                        <div className="w-full space-y-2">
                          <p className="text-base font-semibold text-rose-100">
                            {failedJobTitle || (failedJobIsCancellation ? 'Generacion cancelada' : 'La generacion fallo')}
                          </p>
                          <div className="max-h-56 w-full overflow-y-auto rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-left text-sm leading-6 text-rose-200">
                            <p className="whitespace-pre-wrap break-all">
                              {failedJobMessage || 'No encontramos detalle adicional del error para este job.'}
                            </p>
                            {failedJobTechnicalMessage ? (
                              <p className="mt-2 whitespace-pre-wrap break-all text-xs text-rose-100/90">
                                {failedJobTechnicalMessage}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm">No pudimos cargar esta imagen.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r lg:border-white/10">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="px-4 py-4 sm:px-5" onClick={(e) => e.stopPropagation()}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Historial</p>
                {historyLoading && historyOutputs.length === 0 && !showPendingHistoryPlaceholder ? (
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando intentos...
                  </div>
                ) : historyOutputs.length > 0 || showPendingHistoryPlaceholder ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {historyOutputs.map((output, outputIndex) => (
                      <AttemptThumbnail
                        key={output.id}
                        output={output}
                        label={formatOutputLabel(output, outputIndex)}
                        active={displayedOutput?.id === output.id}
                        effectivelySelected={effectiveSelectedOutputId === output.id}
                        geminiApproved={output.autoReview?.verdict === 'approved'}
                        disabled={Boolean(selectionSavingOutputId)}
                        onSelect={() => void handleSelectHistoryOutput(output.id)}
                      />
                    ))}
                    {showPendingHistoryPlaceholder ? (
                      <div
                        className="shrink-0 rounded-2xl border border-dashed border-sky-400/40 bg-sky-500/10 p-1.5"
                        aria-label="Nueva imagen en generación"
                      >
                        <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-950/70">
                          <div className="flex flex-col items-center gap-2 text-sky-100">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span className="text-[10px] font-medium uppercase tracking-[0.18em]">
                              Generando
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 space-y-1 px-0.5">
                          <p className="text-[11px] font-semibold text-slate-100">Nuevo intento</p>
                          <p className="text-[11px] text-sky-200">Esperando imagen...</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">
                    {isGeneratingJob
                      ? 'Este job todavía está generando su primera foto.'
                      : 'Este job todavía no tiene historial de fotos generado.'}
                  </p>
                )}
              </div>

              <div className="space-y-4 px-4 py-4 sm:px-5">
                {displayedFailureInfo ? (
                  <div
                    className={`rounded-2xl border px-4 py-3 ${
                      failedJobIsCancellation
                        ? 'border-amber-400/30 bg-amber-500/10 text-amber-50'
                        : 'border-rose-400/30 bg-rose-500/10 text-rose-50'
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-sm font-semibold">
                      {failedJobTitle || (failedJobIsCancellation ? 'Generacion cancelada' : 'La generacion fallo')}
                    </p>
                    <p className="mt-2 text-sm leading-6">
                      {failedJobMessage || 'No encontramos detalle adicional del error para esta imagen.'}
                    </p>
                    {failedJobTechnicalMessage ? (
                      <p className={`mt-2 text-xs leading-5 ${failedJobIsCancellation ? 'text-amber-100/90' : 'text-rose-100/90'}`}>
                        {failedJobTechnicalMessage}
                      </p>
                    ) : null}
                    {failedJobFacts.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {failedJobFacts.map((fact) => (
                          <span
                            key={`sidebar-${fact.label}-${fact.value}`}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                              failedJobIsCancellation
                                ? 'border-amber-200/35 bg-amber-400/10 text-amber-50'
                                : 'border-rose-200/35 bg-rose-400/10 text-rose-50'
                            }`}
                          >
                            {fact.label}: {fact.value}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  <label className="block text-xs font-medium uppercase tracking-[0.18em] text-slate-400">URL</label>
                  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950 px-3 py-2.5 shadow-inner shadow-black/20">
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                      {displayedImageValue || 'Sin URL disponible'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyImageUrl()}
                      disabled={!displayedImageValue}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Copiar URL de la imagen"
                      title="Copiar URL"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  <label className="block text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Prompt</label>
                  <textarea
                    value={draft.prompt}
                    onChange={(e) => job.id && updateDraft(job.id, { prompt: e.target.value })}
                    disabled={controlsDisabled}
                    rows={8}
                    className="w-full resize-none rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 shadow-inner shadow-black/20 transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="Prompt para regenerar esta foto..."
                  />
                </div>

                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  <label className="block text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Modelo IA</label>
                  <select
                    value={draft.provider}
                    onChange={(e) => job.id && updateDraft(job.id, { provider: e.target.value as Provider })}
                    disabled={controlsDisabled}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 shadow-inner shadow-black/20 transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {PROVIDER_VALUES.map((provider) => (
                      <option key={provider} value={provider} disabled={disabledProviders?.includes(provider)}>
                        {PROVIDER_LABELS[provider]}{disabledProviders?.includes(provider) ? ' (deshabilitado)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedProviderDisabled ? (
                  <div
                    className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Este modelo IA está deshabilitado en Configuración. Puedes verlo para referencia, pero debes elegir otro para regenerar.
                  </div>
                ) : null}

                {regenerationError ? (
                  <div
                    className="flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-200"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{regenerationError}</span>
                  </div>
                ) : null}

                {!role.canRegenerate ? (
                  <div
                    className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Solo admin y operador pueden regenerar fotos desde catálogo.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="px-4 py-4 sm:px-5" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => void handleRegenerateClick()}
                disabled={controlsDisabled || selectedProviderDisabled || !draft.prompt.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                <RefreshCw className={`h-4 w-4 ${isRegenerationActive ? 'animate-spin' : ''}`} />
                Regenerar foto
              </button>
            </div>
          </aside>

          {showSpreadsheetPanel ? <CatalogProductDraftPanel job={job} /> : null}
        </div>
      </div>
    </div>
  );
};
