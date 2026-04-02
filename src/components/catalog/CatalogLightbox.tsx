import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { AlertCircle, ChevronLeft, ChevronRight, Copy, Download, Loader2, RefreshCw, X } from 'lucide-react';
import { Batch, Job, JobOutput, Provider } from '../../../shared/src/types';
import { PROVIDER_LABELS, PROVIDER_VALUES, resolveApprovedJobOutput } from '../../../shared/src/domain';
import { toMillisOrZero as toMillis } from '../../../shared/src/utils/dateUtils';
import { useJobOutputHistory } from '../../features/evaluation/useJobOutputHistory';
import { useJobRegenerationFirebase } from '../../features/evaluation/useJobRegenerationFirebase';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { useRole } from '../../features/auth/AuthProvider';
import { useToast } from '../../features/feedback/FeedbackProvider';
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
  canGoPrevious: boolean;
  canGoNext: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

export const CatalogLightbox: React.FC<CatalogLightboxProps> = ({
  job,
  canGoPrevious,
  canGoNext,
  onClose,
  onPrevious,
  onNext,
}) => {
  const role = useRole();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
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
    setSelectedOutputId(null);
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

  const currentOutput = job.currentOutput || outputsDesc[0] || null;
  const historyOutputs = useMemo(() => [...outputsDesc].reverse(), [outputsDesc]);
  const displayedOutput = useMemo(
    () => outputsDesc.find((output) => output.id === selectedOutputId) || currentOutput,
    [currentOutput, outputsDesc, selectedOutputId],
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
  const controlsDisabled = !role.canRegenerate || !job.id || isQueueing;
  const displayedImageValue = displayedImageUrl || displayedOutput?.resultImagePath || null;
  const isGeneratingJob = job.status === 'pending' || job.status === 'processing';
  const showSpreadsheetPanel = batch?.outputMode !== 'photos_only';

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
    if (!job.id) return;
    const success = await handleRegenerate(job.id);
    if (success) {
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
          <div className="relative flex min-h-[20rem] items-center justify-center overflow-visible border-b border-white/10 p-4 pt-20 sm:p-6 sm:pt-24 lg:border-b-0 lg:border-r lg:border-white/10 lg:p-8 lg:pt-24">
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

            <div className="flex h-full w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
              {displayedImageUrl ? (
                <HoverZoomImage
                  src={displayedImageUrl}
                  alt={job.garmentName}
                  containerClassName="max-h-full w-full"
                  imageClassName="object-contain"
                  preserveNaturalAspectRatio
                />
              ) : (
                <div className="flex h-full min-h-[22rem] w-full items-center justify-center border border-dashed border-white/15 text-slate-300">
                  {displayedImageLoading || isGeneratingJob ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isGeneratingJob ? 'La imagen todavía se está generando.' : 'Cargando imagen...'}
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
                {historyLoading && historyOutputs.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando intentos...
                  </div>
                ) : historyOutputs.length > 0 ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {historyOutputs.map((output, outputIndex) => (
                      <AttemptThumbnail
                        key={output.id}
                        output={output}
                        label={formatOutputLabel(output, outputIndex)}
                        active={displayedOutput?.id === output.id}
                        userApproved={job.userSelectedOutputId === output.id || job.userSelectedOutput?.id === output.id}
                        onSelect={() => setSelectedOutputId(output.id)}
                      />
                    ))}
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
                      <option key={provider} value={provider}>
                        {PROVIDER_LABELS[provider]}
                      </option>
                    ))}
                  </select>
                </div>

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
                disabled={controlsDisabled || !draft.prompt.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                <RefreshCw className={`h-4 w-4 ${isQueueing ? 'animate-spin' : ''}`} />
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
