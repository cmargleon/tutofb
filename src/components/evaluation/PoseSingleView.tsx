import React, { useEffect, useMemo, useState } from 'react';
import { Batch, Job, JobOutput, Provider } from '../../../shared/src/types';
import { PROVIDER_LABELS, resolveApprovedJobOutput } from '../../../shared/src/domain';
import { useJobRegenerationFirebase } from '../../features/evaluation/useJobRegenerationFirebase';
import { useJobOutputHistory } from '../../features/evaluation/useJobOutputHistory';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { buildGarmentSlides } from '../../features/evaluation/jobSlides';
import { HoverZoomImage } from './HoverZoomImage';
import { AttemptThumbnail } from './AttemptThumbnail';
import { MultiFloatingGarmentPreview } from './MultiFloatingGarmentPreview';
import { BatchErrorLogPanel } from './BatchErrorLogPanel';
import { JobTraceabilityPanel } from './JobTraceabilityPanel';
import { StatusBadge } from '../ui';
import {
  RefreshCw, ChevronLeft, ChevronRight, Heart, AlertTriangle,
  Download, ImageIcon, AlertCircle, XCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { downloadSingleJobImage } from '../../features/evaluation/downloadBatchImages';
import { useToast } from '../../features/feedback/FeedbackProvider';
import { useRole } from '../../features/auth/AuthProvider';
import { toMillisOrZero as toMillis } from '../../../shared/src/utils/dateUtils';

const HISTORY_LIMIT = 18;

const formatOutputLabel = (output: JobOutput, fallbackIndex: number): string =>
  output.generationAttempt ? `Intento ${output.generationAttempt}` : `Salida ${fallbackIndex + 1}`;

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

interface Props {
  batch: Batch;
  jobs: Job[];
  initialFocusJobId?: string | null;
  showFloatingGarment?: boolean;
  headerContent?: React.ReactNode;
  selectedJobIds?: string[];
  selectedOutputIdsByJobId?: Record<string, string | null>;
  onToggleJob?: (jobId: string) => void;
  onSelectJobs?: (jobIds: string[], selected: boolean) => void;
  onSelectOutput?: (jobId: string, outputId: string | null, output: JobOutput | null) => void;
  bulkActions?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// PoseView: renders one pose in full-screen layout
// ─────────────────────────────────────────────────────────────────────────────
interface PoseViewProps {
  batch: Batch;
  job: Job;
  poseIndex: number;
  totalPoses: number;
  garmentIndex: number;
  totalGarments: number;
  draft: { provider: Provider; prompt: string };
  isQueueing: boolean;
  isCancellingGeneration: boolean;
  regenerationError: string | null;
  cancellationError: string | null;
  onUpdateDraft: (updates: Partial<{ provider: Provider; prompt: string }>) => void;
  onRegenerate: () => void;
  onCancelGeneration: () => Promise<void>;
  selectedOutputId: string | null;
  onSelectOutput?: (outputId: string | null, output: JobOutput | null) => void;
  onPrev: () => void;
  onNext: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
}

const PoseView: React.FC<PoseViewProps> = ({
  batch,
  job,
  poseIndex,
  totalPoses,
  garmentIndex,
  totalGarments,
  draft,
  isQueueing,
  isCancellingGeneration,
  regenerationError,
  cancellationError,
  onUpdateDraft,
  onRegenerate,
  onCancelGeneration,
  selectedOutputId,
  onSelectOutput,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
}) => {
  const role = useRole();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const { outputs } = useJobOutputHistory(job.id, HISTORY_LIMIT);

  const outputsDesc = useMemo(() => {
    const merged = new Map<string, JobOutput>();
    [job.userSelectedOutput, job.currentOutput, ...outputs].forEach((output) => {
      if (output?.id && !merged.has(output.id)) merged.set(output.id, output);
    });
    return [...merged.values()].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [job.currentOutput, job.userSelectedOutput, outputs]);

  const currentOutput = job.currentOutput || outputsDesc[0] || null;
  const displayedOutput = useMemo(
    () => outputsDesc.find((o) => o.id === selectedOutputId) || currentOutput,
    [currentOutput, outputsDesc, selectedOutputId],
  );
  const historyOutputs = useMemo(() => [...outputsDesc].reverse(), [outputsDesc]);
  const isViewingLatest = displayedOutput?.id === currentOutput?.id;
  const isUserApproved = Boolean(displayedOutput?.id && selectedOutputId === displayedOutput.id);
  const activeReview = displayedOutput?.autoReview ?? (isViewingLatest ? job.latestAutoReview ?? null : null);

  const { url: displayedImageUrl } = useStorageAssetUrl(displayedOutput?.resultImagePath || null);

  const isProcessing = job.status === 'pending' || job.status === 'processing';
  const isLoadingState = isProcessing || isQueueing;
  const hasOutput = !!displayedImageUrl;
  const canCancelGeneration = role.canRegenerate && isLoadingState && !isCancellingGeneration;
  const showInlineLoadingBadge = hasOutput && isLoadingState && isViewingLatest;
  const showLoadingPlaceholder = !hasOutput && isLoadingState;
  const controlsDisabled = isProcessing || isQueueing || isCancellingGeneration;

  useEffect(() => {
    if (selectedOutputId && !outputsDesc.some((o) => o.id === selectedOutputId)) {
      onSelectOutput?.(null, null);
    }
  }, [onSelectOutput, outputsDesc, selectedOutputId]);

  const handleDownload = async () => {
    if (!displayedOutput?.resultImagePath && !resolveApprovedJobOutput(job)?.resultImagePath) return;
    setDownloading(true);
    try {
      await downloadSingleJobImage(batch, job, poseIndex, selectedOutputId);
    } catch (err) {
      console.error('Error downloading image:', err);
      toast({ tone: 'error', title: 'No pudimos descargar la imagen', description: 'Revisa la conexión o inténtalo de nuevo.' });
    } finally {
      setDownloading(false);
    }
  };

  const handleCancelGeneration = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await onCancelGeneration();
      toast({ tone: 'success', title: 'Generación cancelada', description: `La pose ${poseIndex + 1} dejó de procesarse.` });
    } catch (err) {
      console.error('Error cancelling generation:', err);
      toast({ tone: 'error', title: 'No pudimos cancelar esta generación', description: 'Inténtalo de nuevo en unos segundos.' });
    }
  };

  const handleApprove = () => {
    if (!displayedOutput) return;
    onSelectOutput?.(isUserApproved ? null : displayedOutput.id, isUserApproved ? null : displayedOutput);
  };

  const verdictBadge = isUserApproved
    ? { label: '✓ Elegida', cls: 'bg-emerald-600/90 text-white' }
    : activeReview?.verdict === 'approved'
      ? { label: '✓ OK', cls: 'bg-emerald-600/90 text-white' }
      : activeReview?.verdict === 'rejected'
        ? { label: '↻ Reintento', cls: 'bg-amber-500/90 text-white' }
        : null;

  return (
    <div className="flex h-full">
      {/* ── LEFT PANEL ─────────────────────────────────────────── */}
      <div className="flex w-64 shrink-0 flex-col border-r border-slate-100 overflow-y-auto">
        {/* Garment & pose info */}
        <div className="border-b border-slate-100 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">
            Prenda {garmentIndex + 1} / {totalGarments}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">{job.garmentName}</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xs text-slate-500">Pose {poseIndex + 1} / {totalPoses}</p>
            <StatusBadge status={job.status} />
          </div>
        </div>

        {/* History thumbnails — horizontal scroll */}
        {historyOutputs.length > 0 ? (
          <div className="border-b border-slate-100 px-3 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Historial</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
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
          </div>
        ) : null}

        {/* Prompt + provider */}
        {role.canRegenerate ? (
          <div className="flex flex-col gap-3 px-3 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Prompt</label>
              <textarea
                value={draft.prompt}
                onChange={(e) => onUpdateDraft({ prompt: e.target.value })}
                disabled={controlsDisabled}
                rows={5}
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                placeholder="Prompt para regenerar..."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Modelo IA</label>
              <select
                value={draft.provider}
                onChange={(e) => onUpdateDraft({ provider: e.target.value as Provider })}
                disabled={controlsDisabled}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="fal-seedream">{PROVIDER_LABELS['fal-seedream']}</option>
                <option value="fal-banana-pro">{PROVIDER_LABELS['fal-banana-pro']}</option>
                <option value="openai-gpt-image-1.5">{PROVIDER_LABELS['openai-gpt-image-1.5']}</option>
              </select>
            </div>
          </div>
        ) : null}

        {/* Download individual */}
        {hasOutput && !isLoadingState ? (
          <div className="mt-auto border-t border-slate-100 px-3 py-3">
            <button
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {downloading ? 'Descargando...' : 'Descargar imagen'}
            </button>
          </div>
        ) : null}

        {/* Errors */}
        {(regenerationError || cancellationError || (job.status === 'failed' && job.lastError)) ? (
          <div className="space-y-2 px-3 pb-3">
            {regenerationError ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <span>{regenerationError}</span>
              </div>
            ) : null}
            {cancellationError ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <span>{cancellationError}</span>
              </div>
            ) : null}
            {job.status === 'failed' && job.lastError ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                <span>{job.lastError}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── RIGHT PANEL ────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Image — centered, natural aspect ratio (no gray bars, zoom only on photo) */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* absolute inset-0 gives a definite height so h-full resolves correctly */}
          <div className="absolute inset-0 flex items-center justify-center">
          {hasOutput ? (
            <>
              {/* Wrapper: full height, width from aspect-ratio → no side whitespace */}
              <div className="relative" style={{ height: '100%' }}>
                <HoverZoomImage
                  src={displayedImageUrl!}
                  alt={`Pose ${poseIndex + 1}`}
                  containerClassName="h-full w-auto"
                  imageClassName="h-full w-full"
                  preserveNaturalAspectRatio={true}
                  zoomScale={1.95}
                >
                  {verdictBadge && !isLoadingState ? (
                    <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm ${verdictBadge.cls}`}>
                      {verdictBadge.label}
                    </span>
                  ) : null}
                  {!isViewingLatest ? (
                    <span className="absolute left-3 top-3 rounded-lg bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-white">
                      {formatOutputLabel(
                        displayedOutput!,
                        historyOutputs.findIndex((o) => o.id === displayedOutput?.id),
                      )}
                    </span>
                  ) : null}
                </HoverZoomImage>

                {showInlineLoadingBadge ? (
                  <button
                    type="button"
                    onClick={(e) => void handleCancelGeneration(e)}
                    disabled={!canCancelGeneration}
                    className={`group absolute left-1/2 top-1/2 z-10 inline-flex -translate-x-1/2 -translate-y-1/2 items-center rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-all ${
                      canCancelGeneration
                        ? 'border-indigo-200 bg-white/92 text-indigo-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                        : 'cursor-default border-indigo-200 bg-white/92 text-indigo-700'
                    }`}
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
              </div>
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-slate-50 text-center">
              {job.status === 'failed' && !isLoadingState ? (
                <>
                  <AlertCircle className="mb-2 h-10 w-10 text-red-400" />
                  <p className="text-sm font-medium text-red-600">Error en la generación</p>
                  {job.lastError ? <p className="mt-1 max-w-sm text-xs text-red-500">{job.lastError}</p> : null}
                </>
              ) : showLoadingPlaceholder ? (
                <>
                  <RefreshCw className="mb-4 h-10 w-10 animate-spin text-indigo-600" />
                  <p className="font-medium text-gray-900">{isQueueing ? 'Encolando...' : 'Procesando...'}</p>
                  {canCancelGeneration ? (
                    <button
                      type="button"
                      onClick={(e) => void handleCancelGeneration(e)}
                      className="mt-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 shadow-sm transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {isCancellingGeneration ? 'Cancelando...' : 'Cancelar'}
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <ImageIcon className="mb-2 h-10 w-10 text-slate-300" />
                  <p className="text-sm text-gray-400">Esperando resultado...</p>
                </>
              )}
            </div>
          )}
          </div>{/* end absolute inset-0 centering wrapper */}
        </div>

        {/* ── Action buttons ──────────────────────────────────── */}
        <div className="shrink-0 flex items-center justify-center gap-5 border-t border-slate-100 py-4">
          {/* Regenerate — yellow */}
          <button
            type="button"
            onClick={() => onRegenerate()}
            disabled={controlsDisabled || !draft.prompt.trim() || !role.canRegenerate}
            title="Regenerar foto"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-400 text-white shadow-md transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className={`h-6 w-6 ${isQueueing ? 'animate-spin' : ''}`} />
          </button>

          {/* Previous */}
          <button
            type="button"
            onClick={onPrev}
            disabled={!canGoPrev}
            title="Pose anterior"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-700 shadow-md transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          {/* Approve — heart */}
          <button
            type="button"
            onClick={handleApprove}
            disabled={!hasOutput || isLoadingState}
            title={isUserApproved ? 'Quitar aprobación' : 'Aprobar esta foto'}
            className={`flex h-14 w-14 items-center justify-center rounded-full shadow-md transition ${
              isUserApproved
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'border-2 border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-emerald-500'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <Heart className={`h-6 w-6 ${isUserApproved ? 'fill-current' : ''}`} />
          </button>

          {/* Next */}
          <button
            type="button"
            onClick={onNext}
            disabled={!canGoNext}
            title="Pose siguiente"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-700 shadow-md transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          {/* Flag — no-op for now */}
          <button
            type="button"
            title="Marcar (próximamente)"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-300 shadow-md transition hover:bg-slate-50"
          >
            <AlertTriangle className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible traceability wrapper
// ─────────────────────────────────────────────────────────────────────────────
const CollapsibleTraceability: React.FC<{ batch: Batch; job: Job }> = ({ batch, job }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        <span>Trazabilidad del job</span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open ? (
        <div className="border-t border-slate-100">
          <JobTraceabilityPanel batch={batch} job={job} />
        </div>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export const PoseSingleView: React.FC<Props> = ({
  batch,
  jobs,
  initialFocusJobId = null,
  showFloatingGarment = false,
  headerContent,
  selectedOutputIdsByJobId = {},
  onSelectOutput,
  bulkActions,
}) => {
  const { flatJobs, garmentIndexByJobId, posesPerGarment, garmentSlides } = useMemo(() => {
    const slides = buildGarmentSlides(jobs);
    const flat: Job[] = [];
    const garmentIdx: Record<string, number> = {};
    const posesPerG: Record<string, number> = {};
    slides.forEach((slide, sIdx) => {
      slide.jobs.forEach((job) => {
        if (job.id) {
          garmentIdx[job.id] = sIdx;
          posesPerG[job.id] = slide.jobs.length;
        }
        flat.push(job);
      });
    });
    return { flatJobs: flat, garmentIndexByJobId: garmentIdx, posesPerGarment: posesPerG, garmentSlides: slides };
  }, [jobs]);

  const [activeJobIndex, setActiveJobIndex] = useState(() => {
    if (initialFocusJobId) {
      const idx = flatJobs.findIndex((j) => j.id === initialFocusJobId);
      if (idx >= 0) return idx;
    }
    return 0;
  });

  const safeIndex = Math.min(activeJobIndex, Math.max(0, flatJobs.length - 1));
  const activeJob = flatJobs[safeIndex] ?? null;

  const {
    localDrafts,
    queueingJobs,
    regenerationErrors,
    cancellingJobs,
    cancellationErrors,
    initializeDraft,
    updateDraft,
    handleRegenerate,
    handleCancelGeneration,
  } = useJobRegenerationFirebase();

  useEffect(() => {
    if (activeJob) initializeDraft(activeJob);
  }, [activeJob, initializeDraft]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveJobIndex((prev) => Math.max(0, prev - 1));
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveJobIndex((prev) => Math.min(flatJobs.length - 1, prev + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flatJobs.length]);

  const handleFocusJob = (jobId: string) => {
    const idx = flatJobs.findIndex((j) => j.id === jobId);
    if (idx >= 0) setActiveJobIndex(idx);
  };

  if (!activeJob) return null;

  const activeJobId = activeJob.id!;
  const draft = localDrafts[activeJobId] ?? { provider: activeJob.provider, prompt: activeJob.promptBase || activeJob.finalPrompt || '' };

  const garmentIdx = garmentIndexByJobId[activeJobId] ?? 0;
  const currentSlide = garmentSlides[garmentIdx];
  const poseIdxInGarment = currentSlide ? currentSlide.jobs.findIndex((j) => j.id === activeJobId) : 0;
  const totalPosesInGarment = posesPerGarment[activeJobId] ?? 1;

  const garmentStoragePaths = useMemo((): string[] => {
    if (!activeJob.garmentIsMultiAngle || !activeJob.garmentOriginalFileNames?.length || activeJob.garmentOriginalFileNames.length < 2) {
      return [activeJob.garmentFilePath];
    }
    const lastSlash = activeJob.garmentFilePath.lastIndexOf('/');
    const folder = lastSlash >= 0 ? activeJob.garmentFilePath.slice(0, lastSlash + 1) : '';
    return activeJob.garmentOriginalFileNames.map((name) => `${folder}${name}`);
  }, [activeJob.garmentFilePath, activeJob.garmentIsMultiAngle, activeJob.garmentOriginalFileNames]);

  return (
    <div className="flex flex-col gap-3">
      {/* Optional header (collapsed lote info) */}
      {headerContent ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          {headerContent}
          {bulkActions ? <div className="mt-3">{bulkActions}</div> : null}
        </div>
      ) : null}

      <BatchErrorLogPanel
        jobs={jobs}
        focusedJobId={activeJob.id ?? null}
        onFocusJob={handleFocusJob}
      />

      {/* Main pose view — fills viewport height minus header area */}
      <div
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        style={{ height: 'calc(100vh - 9rem)' }}
      >
        <PoseView
          batch={batch}
          job={activeJob}
          poseIndex={poseIdxInGarment}
          totalPoses={totalPosesInGarment}
          garmentIndex={garmentIdx}
          totalGarments={garmentSlides.length}
          draft={draft}
          isQueueing={!!queueingJobs[activeJobId]}
          isCancellingGeneration={!!cancellingJobs[activeJobId]}
          regenerationError={regenerationErrors[activeJobId] ?? null}
          cancellationError={cancellationErrors[activeJobId] ?? null}
          onUpdateDraft={(updates) => updateDraft(activeJobId, updates)}
          onRegenerate={() => handleRegenerate(activeJobId)}
          onCancelGeneration={() => handleCancelGeneration(activeJobId)}
          selectedOutputId={selectedOutputIdsByJobId[activeJobId] ?? null}
          onSelectOutput={onSelectOutput ? (outputId, output) => onSelectOutput(activeJobId, outputId, output) : undefined}
          onPrev={() => setActiveJobIndex((prev) => Math.max(0, prev - 1))}
          onNext={() => setActiveJobIndex((prev) => Math.min(flatJobs.length - 1, prev + 1))}
          canGoPrev={safeIndex > 0}
          canGoNext={safeIndex < flatJobs.length - 1}
        />
      </div>

      {/* Traceability — collapsed by default */}
      <CollapsibleTraceability batch={batch} job={activeJob} />

      {/* Floating garment preview */}
      {showFloatingGarment ? (
        <MultiFloatingGarmentPreview
          garmentName={activeJob.garmentName}
          storagePaths={garmentStoragePaths}
        />
      ) : null}
    </div>
  );
};
