import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { AlertCircle, Copy, Download, Images, RefreshCw, X, ChevronDown, ChevronRight, Loader2, ChevronLeft } from 'lucide-react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../firebase';
import { LoadingBlock } from '../components/ui';
import { subscribeToClients } from '../features/clients/firebase';
import { useCatalogJobs, CatalogGarmentGroup } from '../features/catalog/useCatalogJobs';
import { Batch, Client, Job, JobOutput, Provider } from '../../shared/src/types';
import { PROVIDER_LABELS, PROVIDER_VALUES, resolveApprovedJobOutput } from '../../shared/src/domain';
import { formatDateTimeLong, toMillisOrZero as toMillis } from '../../shared/src/utils/dateUtils';
import FileSaver from 'file-saver';
import { AttemptThumbnail } from '../components/evaluation/AttemptThumbnail';
import { HoverZoomImage } from '../components/evaluation/HoverZoomImage';
import { useRole } from '../features/auth/AuthProvider';
import { useToast } from '../features/feedback/FeedbackProvider';
import { useJobOutputHistory } from '../features/evaluation/useJobOutputHistory';
import { useJobRegenerationFirebase } from '../features/evaluation/useJobRegenerationFirebase';
import { useStorageAssetUrl } from '../features/storage/useStorageAssetUrl';

const HISTORY_LIMIT = 18;
const formatOutputLabel = (output: JobOutput, fallbackIndex: number): string =>
  output.generationAttempt ? `Intento ${output.generationAttempt}` : `Salida ${fallbackIndex + 1}`;

// ─── Thumbnail ────────────────────────────────────────────────────────────────

interface ThumbnailProps {
  job: Job;
  onClick: (job: Job) => void;
}

const Thumbnail: React.FC<ThumbnailProps> = ({ job, onClick }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const resultPath = resolveApprovedJobOutput(job)?.resultImagePath;

  useEffect(() => {
    if (!resultPath) return;
    let cancelled = false;
    getDownloadURL(ref(storage, resultPath))
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [resultPath]);

  if (loadError || !resultPath) return null;

  return (
    <button
      type="button"
      onClick={() => url && onClick(job)}
      className="relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition-colors hover:border-indigo-400"
      title={job.garmentName}
    >
      {url ? (
        <img
          src={url}
          alt={job.garmentName}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2">
        <p className="text-white text-xs truncate">{job.modelNameSnapshot}</p>
      </div>
    </button>
  );
};

// ─── Garment section ──────────────────────────────────────────────────────────

interface GarmentSectionProps {
  group: CatalogGarmentGroup;
  onImageClick: (job: Job) => void;
}

const GarmentSection: React.FC<GarmentSectionProps> = ({ group, onImageClick }) => {
  const [expanded, setExpanded] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const handleDownloadAll = async () => {
    setDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder(group.garmentName.replace(/[^a-zA-Z0-9_-]/g, '_')) ?? zip;

      await Promise.all(
        group.jobs.map(async (job) => {
          const path = resolveApprovedJobOutput(job)?.resultImagePath;
          if (!path) return;
          try {
            const downloadUrl = await getDownloadURL(ref(storage, path));
            const resp = await fetch(downloadUrl);
            const buf = await resp.arrayBuffer();
            const ext = path.split('?')[0].split('.').pop() || 'png';
            folder.file(`${job.modelNameSnapshot}_${job.id}.${ext}`, buf);
          } catch {
            // skip failed images
          }
        }),
      );

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      FileSaver.saveAs(blob, `${group.garmentName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`);
    } catch (e) {
      console.error('Error creating ZIP:', e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between bg-gray-50 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex min-w-0 cursor-pointer items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
          )}
          <span className="font-medium text-gray-900 truncate">{group.garmentName}</span>
          <span className="text-xs text-gray-500 shrink-0">({group.jobs.length})</span>
        </button>
        <button
          type="button"
          onClick={handleDownloadAll}
          disabled={downloading}
          className="ml-4 flex cursor-pointer items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
          title="Descargar todas las imágenes de esta prenda"
        >
          {downloading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">Descargar</span>
        </button>
      </div>

      {expanded && (
        <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {group.jobs.map((job) => (
            <Thumbnail key={job.id} job={job} onClick={() => onImageClick(job)} />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Garment floating thumbnail ───────────────────────────────────────────────

const GarmentThumbnailFloat: React.FC<{ job: Job }> = ({ job }) => {
  const paths = useMemo(() => {
    if (job.garmentIsMultiAngle && job.garmentOriginalFileNames && job.garmentOriginalFileNames.length > 0) {
      return job.garmentOriginalFileNames.map((name) => `garments/${job.garmentId}/${name}`);
    }
    return [job.garmentFilePath];
  }, [job]);

  const [urls, setUrls] = useState<(string | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(paths.map((path) => getDownloadURL(ref(storage, path)).catch(() => null))).then((results) => {
      if (!cancelled) setUrls(results);
    });
    return () => { cancelled = true; };
  }, [paths]);

  const loadedUrls = urls.filter(Boolean) as string[];

  if (loadedUrls.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 z-30 flex flex-col items-start gap-1.5 isolate" onClick={(e) => e.stopPropagation()}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">Prenda</p>
      <div className="flex flex-col gap-1.5">
        {loadedUrls.map((url, i) => (
          <div key={`${url}-${i}`} className="group relative">
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-400/70"
              aria-label={`Ver prenda de referencia${loadedUrls.length > 1 ? ` ${i + 1}` : ''}`}
            >
              <img
                src={url}
                alt={`${job.garmentName}${loadedUrls.length > 1 ? ` referencia ${i + 1}` : ''}`}
                className="h-20 w-auto cursor-zoom-in rounded-xl border border-white/10 bg-white/90 object-contain shadow-lg transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-xl group-focus-within:-translate-y-0.5 group-focus-within:shadow-xl"
                referrerPolicy="no-referrer"
              />
            </button>

            <div className="pointer-events-none absolute bottom-0 left-full ml-3 z-40 origin-bottom-left opacity-0 transition duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:[transform:translateY(0)_scale(1)] group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-focus-within:[transform:translateY(0)_scale(1)] [transform:translateY(8px)_scale(0.96)]">
              <div className="w-[18rem] rounded-[1.4rem] border border-white/10 bg-slate-950/92 p-3 shadow-2xl shadow-black/45 backdrop-blur-md">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300">
                  Prenda de referencia
                </p>
                <HoverZoomImage
                  src={url}
                  alt={`${job.garmentName}${loadedUrls.length > 1 ? ` referencia ${i + 1}` : ''}`}
                  containerClassName="h-[25rem] w-full rounded-[1rem] bg-white"
                  imageClassName="h-full w-full object-contain"
                  preserveNaturalAspectRatio
                />
                <p className="mt-3 text-sm font-medium text-white/90">{job.garmentName}</p>
                {loadedUrls.length > 1 ? (
                  <p className="mt-1 text-xs text-white/60">Vista {i + 1} de {loadedUrls.length}</p>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Lightbox ─────────────────────────────────────────────────────────────────

interface LightboxProps {
  job: Job;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

const Lightbox: React.FC<LightboxProps> = ({
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
      toast({
        tone: 'success',
        title: 'URL copiada',
      });
    } catch (error) {
      console.error('Failed to copy image URL:', error);
      toast({
        tone: 'error',
        title: 'No pudimos copiar la URL',
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="relative flex h-full max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden text-white">
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

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.2fr)_24rem]">
          <div className="relative flex min-h-[20rem] items-center justify-center overflow-visible p-4 pt-20 sm:p-6 sm:pt-24 lg:p-8 lg:pt-24">
            {canGoPrevious ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPrevious();
                }}
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
                onClick={(e) => {
                  e.stopPropagation();
                  onNext();
                }}
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

            <GarmentThumbnailFloat job={job} />

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
                  {displayedImageLoading ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Cargando imagen...
                    </div>
                  ) : (
                    <div className="text-sm">No pudimos cargar esta imagen.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col">
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
                  <p className="text-sm text-slate-400">Este job todavía no tiene historial de fotos generado.</p>
                )}
              </div>

              <div className="space-y-4 px-4 py-4 sm:px-5">
                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  <label className="block text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                    URL
                  </label>
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
                  <label className="block text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                    Prompt
                  </label>
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
                  <label className="block text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                    Modelo IA
                  </label>
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
        </div>
      </div>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

export const Catalogo: React.FC = () => {
  const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [pageSize, setPageSize] = useState<number>(25);
  const [lightbox, setLightbox] = useState<{ garmentIndex: number; jobIndex: number; jobId: string } | null>(null);

  const {
    batches,
    jobs,
    garmentGroups,
    loading,
    error,
    currentPage,
    totalPages,
    hasPreviousPage,
    hasNextPage,
    goToPreviousPage,
    goToNextPage,
  } = useCatalogJobs({
    clientId: selectedClientId || null,
    batchId: selectedBatchId || null,
    pageSize,
  });
  const catalogJobs = jobs;

  const lightboxIndexByJobId = useMemo(() => {
    const map = new Map<string, { garmentIndex: number; jobIndex: number }>();
    garmentGroups.forEach((group, garmentIndex) => {
      group.jobs.forEach((job, jobIndex) => {
        if (job.id) {
          map.set(job.id, { garmentIndex, jobIndex });
        }
      });
    });
    return map;
  }, [garmentGroups]);

  const batchOptions = useMemo(
    () => batches.filter((batch): batch is Batch & { id: string } => Boolean(batch.id)),
    [batches],
  );
  const selectedBatchLabel = useMemo(() => {
    if (!selectedBatchId) return 'Todos los lotes';
    const selectedBatch = batchOptions.find((batch) => batch.id === selectedBatchId);
    return selectedBatch
      ? `${formatDateTimeLong(selectedBatch.createdAt)} · ${selectedBatch.id}`
      : selectedBatchId;
  }, [batchOptions, selectedBatchId]);

  useEffect(() => {
    const unsub = subscribeToClients(
      (c) => setClients(c),
      () => {},
    );
    return unsub;
  }, []);

  useEffect(() => {
    setSelectedBatchId('');
  }, [selectedClientId]);

  useEffect(() => {
    setLightbox(null);
  }, [currentPage, pageSize, selectedBatchId, selectedClientId]);

  const openLightboxForJob = useCallback((job: Job) => {
    if (!job.id || !resolveApprovedJobOutput(job)?.resultImagePath) return;
    const targetIndexes = lightboxIndexByJobId.get(job.id);
    if (!targetIndexes) return;
    setLightbox({ jobId: job.id, ...targetIndexes });
  }, [lightboxIndexByJobId]);

  const handleImageClick = useCallback((job: Job) => {
    openLightboxForJob(job);
  }, [openLightboxForJob]);

  const handleCloseLightbox = useCallback(() => setLightbox(null), []);

  const previousLightboxTarget = useMemo(() => {
    if (!lightbox) return null;

    const currentGroup = garmentGroups[lightbox.garmentIndex];
    if (!currentGroup) return null;

    const previousJobInGroup = currentGroup.jobs[lightbox.jobIndex - 1];
    if (previousJobInGroup?.id) {
      return {
        garmentIndex: lightbox.garmentIndex,
        jobIndex: lightbox.jobIndex - 1,
        jobId: previousJobInGroup.id,
      };
    }

    const previousGroup = garmentGroups[lightbox.garmentIndex - 1];
    const previousGroupLastJob = previousGroup?.jobs[previousGroup.jobs.length - 1];
    if (previousGroupLastJob?.id) {
      return {
        garmentIndex: lightbox.garmentIndex - 1,
        jobIndex: previousGroup.jobs.length - 1,
        jobId: previousGroupLastJob.id,
      };
    }

    return null;
  }, [garmentGroups, lightbox]);

  const nextLightboxTarget = useMemo(() => {
    if (!lightbox) return null;

    const currentGroup = garmentGroups[lightbox.garmentIndex];
    if (!currentGroup) return null;

    const nextJobInGroup = currentGroup.jobs[lightbox.jobIndex + 1];
    if (nextJobInGroup?.id) {
      return {
        garmentIndex: lightbox.garmentIndex,
        jobIndex: lightbox.jobIndex + 1,
        jobId: nextJobInGroup.id,
      };
    }

    const nextGroup = garmentGroups[lightbox.garmentIndex + 1];
    const nextGroupFirstJob = nextGroup?.jobs[0];
    if (nextGroupFirstJob?.id) {
      return {
        garmentIndex: lightbox.garmentIndex + 1,
        jobIndex: 0,
        jobId: nextGroupFirstJob.id,
      };
    }

    return null;
  }, [garmentGroups, lightbox]);

  const handlePreviousLightbox = useCallback(() => {
    if (!previousLightboxTarget) return;
    setLightbox(previousLightboxTarget);
  }, [previousLightboxTarget]);

  const handleNextLightbox = useCallback(() => {
    if (!nextLightboxTarget) return;
    setLightbox(nextLightboxTarget);
  }, [nextLightboxTarget]);

  const lightboxJob = useMemo(() => {
    if (!lightbox) return null;
    const indexedJob = garmentGroups[lightbox.garmentIndex]?.jobs[lightbox.jobIndex];
    if (indexedJob?.id === lightbox.jobId) return indexedJob;

    const fallbackIndexes = lightboxIndexByJobId.get(lightbox.jobId);
    if (!fallbackIndexes) return null;

    return garmentGroups[fallbackIndexes.garmentIndex]?.jobs[fallbackIndexes.jobIndex] || null;
  }, [garmentGroups, lightbox, lightboxIndexByJobId]);

  const pageLabel = totalPages ? `Página ${currentPage} de ${totalPages}` : `Página ${currentPage}`;
  const paginationControls = selectedClientId && !loading && !error ? (
    <div className="flex items-center gap-2 self-start sm:self-auto">
      <button
        type="button"
        onClick={goToPreviousPage}
        disabled={!hasPreviousPage}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" />
        Anterior
      </button>
      <button
        type="button"
        onClick={() => void goToNextPage()}
        disabled={!hasNextPage}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Siguiente
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,22rem)_10rem]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">Cliente</span>
              <select
                id="catalog-client"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Selecciona un cliente...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">Lote</span>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                disabled={!selectedClientId}
                className="w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">Todos los lotes</option>
                {batchOptions.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {formatDateTimeLong(batch.createdAt)} · {batch.id}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">Jobs por página</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                disabled={!selectedClientId}
                className="w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedClientId && !loading && !error && (
            <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-500">
                <span>{selectedBatchLabel}</span>
                <span className="mx-2">·</span>
                <span>{pageLabel}</span>
                <span className="mx-2">·</span>
                <span>{catalogJobs.length} job{catalogJobs.length === 1 ? '' : 's'} visibles</span>
              </div>
              {paginationControls}
            </div>
          )}
        </div>

        {/* States */}
        {!selectedClientId && (
          <div className="text-center py-16 text-gray-400">
            <Images className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>Selecciona un cliente para ver su catálogo</p>
          </div>
        )}

        {selectedClientId && loading && (
          <div className="flex items-center justify-center py-16">
            <LoadingBlock />
          </div>
        )}

        {selectedClientId && !loading && error && (
          <div className="text-center py-16 text-red-500 text-sm">{error}</div>
        )}

        {selectedClientId && !loading && !error && garmentGroups.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p>{selectedBatchId ? 'No hay imágenes completadas para ese lote' : 'No hay imágenes completadas para este cliente'}</p>
          </div>
        )}

        {/* Garment sections */}
        {!loading && garmentGroups.length > 0 && (
          <div className="space-y-4">
            {garmentGroups.map((group) => (
              <GarmentSection
                key={group.garmentId}
                group={group}
                onImageClick={handleImageClick}
              />
            ))}
            <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-500">
                <span>{selectedBatchLabel}</span>
                <span className="mx-2">·</span>
                <span>{pageLabel}</span>
                <span className="mx-2">·</span>
                <span>{catalogJobs.length} job{catalogJobs.length === 1 ? '' : 's'} visibles</span>
              </div>
              {paginationControls}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && lightboxJob && (
        <Lightbox
          job={lightboxJob}
          canGoPrevious={Boolean(previousLightboxTarget)}
          canGoNext={Boolean(nextLightboxTarget)}
          onClose={handleCloseLightbox}
          onPrevious={handlePreviousLightbox}
          onNext={handleNextLightbox}
        />
      )}
    </div>
  );
};
