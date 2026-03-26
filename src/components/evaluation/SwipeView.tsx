import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Batch, Job, JobOutput, Provider } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { useJobRegenerationFirebase } from '../../features/evaluation/useJobRegenerationFirebase';
import { useRole } from '../../features/auth/AuthProvider';
import { HoverZoomImage } from './HoverZoomImage';
import { StatusBadge } from '../ui';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  ImageIcon,
  Keyboard,
  RefreshCw,
  Settings2,
  XCircle,
} from 'lucide-react';

interface Props {
  batch: Batch;
  jobs: Job[];
  selectedOutputIdsByJobId: Record<string, string | null>;
  onSelectOutput: (jobId: string, outputId: string | null, output: JobOutput | null) => void;
}

type VerdictFilter = 'all' | 'approved' | 'rejected' | 'pending' | 'failed';

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const poseLabelFromPath = (path: string): string => {
  const filename = path.split('/').pop() || path;
  return filename.replace(/\.[^/.]+$/, '');
};

const INPUT_BASE =
  'w-full rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed';

// ── Sub-component: single job image display ───────────────────────────────────
const JobImage: React.FC<{ job: Job }> = ({ job }) => {
  const displayOutput = resolveApprovedJobOutput(job);
  const { url, loading } = useStorageAssetUrl(displayOutput?.resultImagePath ?? null);

  if (job.status === 'processing' || job.status === 'pending') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100">
        <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
        <span className="ml-3 text-sm text-slate-500">
          {job.status === 'processing' ? 'Generando...' : 'En cola...'}
        </span>
      </div>
    );
  }

  if (!displayOutput?.resultImagePath) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-100 text-slate-400">
        <ImageIcon className="h-10 w-10" />
        <span className="text-xs">{job.status === 'failed' ? 'Generación fallida' : 'Sin imagen'}</span>
      </div>
    );
  }

  if (loading || !url) {
    return <div className="h-full w-full animate-pulse bg-slate-200" />;
  }

  return (
    <HoverZoomImage
      src={url}
      alt={`${job.garmentName} – ${poseLabelFromPath(job.poseImagePath ?? '')}`}
      containerClassName="h-full w-full"
      imageClassName="object-cover"
    />
  );
};

// ── Sub-component: garment reference ─────────────────────────────────────────
const GarmentRef: React.FC<{ storagePath: string; name: string }> = ({ storagePath, name }) => {
  const { url, loading } = useStorageAssetUrl(storagePath);

  if (loading || !url) {
    return <div className="h-full w-full animate-pulse rounded-xl bg-slate-200" />;
  }

  return (
    <HoverZoomImage
      src={url}
      alt={`Prenda: ${name}`}
      containerClassName="h-full w-full rounded-xl overflow-hidden"
      imageClassName="object-contain"
      zoomScale={2.5}
    />
  );
};

// ── Main SwipeView ────────────────────────────────────────────────────────────
export const SwipeView: React.FC<Props> = ({ batch, jobs, selectedOutputIdsByJobId, onSelectOutput }) => {
  const role = useRole();
  const canRegenerate = role.canRegenerate;

  const {
    localDrafts,
    queueingJobs,
    regenerationErrors,
    initializeDraft,
    updateDraft,
    handleRegenerate,
  } = useJobRegenerationFirebase();

  // ── Filters ────────────────────────────────────────────────────────────────
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');
  const [garmentFilter, setGarmentFilter] = useState<string>('all');
  const [poseFilter, setPoseFilter] = useState<string>('all');
  const [colorFilter, setColorFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  const garmentNames = useMemo(() => Array.from(new Set(jobs.map((j) => j.garmentName))).sort(), [jobs]);
  const poseLabels = useMemo(
    () =>
      Array.from(new Set(jobs.map((j) => poseLabelFromPath(j.poseImagePath ?? '')))).filter(Boolean).sort(),
    [jobs],
  );
  const colors = useMemo(
    () =>
      Array.from(
        new Set(jobs.map((j) => j.latestAutoReview?.marketplaceData?.primaryColor).filter(Boolean) as string[]),
      ).sort(),
    [jobs],
  );

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (verdictFilter === 'approved' && job.latestAutoReview?.verdict !== 'approved') return false;
      if (verdictFilter === 'rejected' && job.latestAutoReview?.verdict !== 'rejected') return false;
      if (verdictFilter === 'pending' && job.latestAutoReview != null) return false;
      if (verdictFilter === 'failed' && job.status !== 'failed') return false;
      if (garmentFilter !== 'all' && job.garmentName !== garmentFilter) return false;
      if (poseFilter !== 'all' && poseLabelFromPath(job.poseImagePath ?? '') !== poseFilter) return false;
      if (colorFilter !== 'all' && job.latestAutoReview?.marketplaceData?.primaryColor !== colorFilter)
        return false;
      return true;
    });
  }, [jobs, verdictFilter, garmentFilter, poseFilter, colorFilter]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const safeIndex = Math.min(currentIndex, Math.max(0, filteredJobs.length - 1));
  const currentJob = filteredJobs[safeIndex] ?? null;

  const prevJob = useCallback(() => setCurrentIndex((i) => Math.max(0, i - 1)), []);
  const nextJob = useCallback(
    () => setCurrentIndex((i) => Math.min(filteredJobs.length - 1, i + 1)),
    [filteredJobs.length],
  );

  // Reset index when filters change
  useEffect(() => {
    setCurrentIndex(0);
  }, [verdictFilter, garmentFilter, poseFilter, colorFilter]);

  // Initialize draft when job changes
  useEffect(() => {
    if (currentJob) {
      initializeDraft(currentJob);
    }
  }, [currentJob, initializeDraft]);

  // ── Controls panel ─────────────────────────────────────────────────────────
  const [showControls, setShowControls] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showControls) {
      setTimeout(() => promptRef.current?.focus(), 50);
    }
  }, [showControls]);

  // ── Approve action ─────────────────────────────────────────────────────────
  const handleApprove = useCallback(() => {
    if (!currentJob?.id) return;
    const displayOutput = resolveApprovedJobOutput(currentJob);
    if (!displayOutput) return;

    const alreadySelected = selectedOutputIdsByJobId[currentJob.id] === displayOutput.id ||
      (!selectedOutputIdsByJobId[currentJob.id] && currentJob.userSelectedOutputId === displayOutput.id);

    onSelectOutput(currentJob.id, alreadySelected ? null : displayOutput.id, alreadySelected ? null : displayOutput);
  }, [currentJob, selectedOutputIdsByJobId, onSelectOutput]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prevJob();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        nextJob();
      } else if (event.key === ' ') {
        event.preventDefault();
        handleApprove();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (showControls && currentJob?.id) {
          handleRegenerate(currentJob.id);
        } else {
          setShowControls(true);
        }
      } else if (event.key === 'Escape') {
        setShowControls(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [prevJob, nextJob, handleApprove, showControls, currentJob, handleRegenerate]);

  // ── Touch swipe ────────────────────────────────────────────────────────────
  const touchStartX = useRef<number | null>(null);

  const onTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.touches[0].clientX;
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (delta > 60) prevJob();
    else if (delta < -60) nextJob();
  };

  // ── Approve state ─────────────────────────────────────────────────────────
  const isApproved = useMemo(() => {
    if (!currentJob?.id) return false;
    const displayOutput = resolveApprovedJobOutput(currentJob);
    if (!displayOutput) return false;
    const selected = selectedOutputIdsByJobId[currentJob.id];
    if (selected !== undefined) return selected === displayOutput.id;
    return currentJob.userSelectedOutputId === displayOutput.id;
  }, [currentJob, selectedOutputIdsByJobId]);

  const currentDraft = currentJob?.id ? localDrafts[currentJob.id] : null;
  const isQueueing = currentJob?.id ? !!queueingJobs[currentJob.id] : false;
  const regenError = currentJob?.id ? regenerationErrors[currentJob.id] : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (filteredJobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-slate-500">
        <ImageIcon className="h-10 w-10 text-slate-300" />
        <p className="text-sm">No hay fotos que coincidan con los filtros.</p>
        <button
          type="button"
          onClick={() => {
            setVerdictFilter('all');
            setGarmentFilter('all');
            setPoseFilter('all');
            setColorFilter('all');
          }}
          className="text-xs text-indigo-600 hover:underline"
        >
          Limpiar filtros
        </button>
      </div>
    );
  }

  const verdictBadge = currentJob?.latestAutoReview?.verdict;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
            showFilters ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          Filtros
          {(verdictFilter !== 'all' || garmentFilter !== 'all' || poseFilter !== 'all' || colorFilter !== 'all') && (
            <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[10px] text-white">
              {[verdictFilter !== 'all', garmentFilter !== 'all', poseFilter !== 'all', colorFilter !== 'all'].filter(Boolean).length}
            </span>
          )}
        </button>

        {showFilters && (
          <>
            <select
              value={verdictFilter}
              onChange={(e) => setVerdictFilter(e.target.value as VerdictFilter)}
              className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none"
            >
              <option value="all">Todos los veredictos</option>
              <option value="approved">✅ Aprobado por Gemini</option>
              <option value="rejected">❌ Rechazado por Gemini</option>
              <option value="pending">⏳ Sin revisión Gemini</option>
              <option value="failed">🔴 Fallidos</option>
            </select>

            <select
              value={garmentFilter}
              onChange={(e) => setGarmentFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none"
            >
              <option value="all">Todas las prendas</option>
              {garmentNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            {poseLabels.length > 1 && (
              <select
                value={poseFilter}
                onChange={(e) => setPoseFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none"
              >
                <option value="all">Todas las poses</option>
                {poseLabels.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}

            {colors.length > 0 && (
              <select
                value={colorFilter}
                onChange={(e) => setColorFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none"
              >
                <option value="all">Todos los colores</option>
                {colors.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-800">{safeIndex + 1}</span>
          <span>/</span>
          <span>{filteredJobs.length}</span>
        </div>
      </div>

      {/* ── Main photo area ─────────────────────────────────────────────────── */}
      <div
        className="relative flex gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Garment reference */}
        {currentJob && (
          <div className="hidden w-28 shrink-0 flex-col gap-2 sm:flex">
            <p className="text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">Prenda ref.</p>
            <div className="h-40 w-full">
              <GarmentRef storagePath={currentJob.garmentFilePath} name={currentJob.garmentName} />
            </div>
            <p className="text-center text-[10px] text-slate-500 leading-tight">{currentJob.garmentName}</p>
          </div>
        )}

        {/* Generated photo */}
        <div className="relative flex flex-1 flex-col gap-2">
          {currentJob && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  {poseLabelFromPath(currentJob.poseImagePath ?? '')}
                </p>
                <StatusBadge status={currentJob.status} />
                {verdictBadge && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      verdictBadge === 'approved'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {verdictBadge === 'approved' ? '✅ Gemini' : '❌ Gemini'}
                  </span>
                )}
              </div>
              {isApproved && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Seleccionada
                </span>
              )}
            </div>
          )}

          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-slate-200">
            {currentJob ? <JobImage job={currentJob} /> : null}

            {/* Swipe nav arrows on photo */}
            <button
              type="button"
              onClick={prevJob}
              disabled={safeIndex === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-md backdrop-blur-sm transition hover:bg-white disabled:opacity-30"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-5 w-5 text-slate-700" />
            </button>

            <button
              type="button"
              onClick={nextJob}
              disabled={safeIndex === filteredJobs.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-md backdrop-blur-sm transition hover:bg-white disabled:opacity-30"
              aria-label="Siguiente"
            >
              <ChevronRight className="h-5 w-5 text-slate-700" />
            </button>
          </div>

          {/* Gemini summary */}
          {currentJob?.latestAutoReview?.summary && (
            <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              {currentJob.latestAutoReview.summary}
            </p>
          )}
        </div>
      </div>

      {/* ── Action buttons ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        {/* Approve */}
        <button
          type="button"
          onClick={handleApprove}
          disabled={!currentJob || !resolveApprovedJobOutput(currentJob)}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
            isApproved
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          {isApproved ? 'Quitar selección' : 'Aprobar'}
        </button>

        {/* Regenerate toggle */}
        {canRegenerate && (
          <button
            type="button"
            onClick={() => setShowControls((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
              showControls
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Settings2 className="h-4 w-4" />
            Regenerar
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Counter nav */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevJob}
            disabled={safeIndex === 0}
            className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600 transition hover:bg-slate-100 disabled:opacity-30"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[4rem] text-center text-sm text-slate-600">
            {safeIndex + 1} / {filteredJobs.length}
          </span>
          <button
            type="button"
            onClick={nextJob}
            disabled={safeIndex === filteredJobs.length - 1}
            className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600 transition hover:bg-slate-100 disabled:opacity-30"
            aria-label="Siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Regenerate controls panel (expandable) ────────────────────────── */}
      {showControls && currentJob && currentDraft && (
        <div className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-indigo-900">Configurar regeneración</p>
            <button
              type="button"
              onClick={() => setShowControls(false)}
              className="rounded-lg p-1 text-indigo-400 hover:bg-indigo-100"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-indigo-800 mb-1.5">Proveedor IA</label>
            <select
              value={currentDraft.provider}
              onChange={(e) => updateDraft(currentJob.id!, { provider: e.target.value as Provider })}
              disabled={isQueueing}
              className={INPUT_BASE}
            >
              <option value="fal-seedream">{PROVIDER_LABELS['fal-seedream']}</option>
              <option value="fal-banana-pro">{PROVIDER_LABELS['fal-banana-pro']}</option>
              <option value="openai-gpt-image-1.5">{PROVIDER_LABELS['openai-gpt-image-1.5']}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-indigo-800 mb-1.5">Prompt</label>
            <textarea
              ref={promptRef}
              value={currentDraft.prompt}
              onChange={(e) => updateDraft(currentJob.id!, { prompt: e.target.value })}
              disabled={isQueueing}
              rows={4}
              className={`${INPUT_BASE} resize-none`}
              placeholder="Define el prompt para regenerar..."
            />
          </div>

          {regenError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {regenError}
            </p>
          )}

          <button
            type="button"
            onClick={() => handleRegenerate(currentJob.id!)}
            disabled={isQueueing || !currentDraft.prompt.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isQueueing ? 'animate-spin' : ''}`} />
            {isQueueing ? 'Encolando...' : 'Regenerar foto'}
          </button>
        </div>
      )}

      {/* ── Keyboard hints ─────────────────────────────────────────────────── */}
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Keyboard className="h-3.5 w-3.5 shrink-0" />
        ← → navegar · Espacio aprobar · Enter regenerar · Esc cerrar panel
        {window.innerWidth > 640 ? '' : ' · Desliza para navegar'}
      </p>
    </div>
  );
};
