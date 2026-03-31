import React, { useEffect, useMemo, useState } from 'react';
import { Batch, Job, JobOutput } from '../../../shared/src/types';
import { useJobRegenerationFirebase } from '../../features/evaluation/useJobRegenerationFirebase';
import { buildGarmentSlides } from '../../features/evaluation/jobSlides';
import { BatchErrorLogPanel } from './BatchErrorLogPanel';
import { PoseView } from './PoseView';
import { GarmentRail } from './GarmentRail';
import { CollapsibleTraceability } from './CollapsibleTraceability';
import { List, Shirt } from 'lucide-react';

interface Props {
  batch: Batch;
  jobs: Job[];
  initialFocusJobId?: string | null;
  headerContent?: React.ReactNode;
  selectedOutputIdsByJobId?: Record<string, string | null>;
  onSelectOutput?: (jobId: string, outputId: string | null, output: JobOutput | null) => void;
  bulkActions?: React.ReactNode;
}

export const PoseSingleView: React.FC<Props> = ({
  batch,
  jobs,
  initialFocusJobId = null,
  headerContent,
  selectedOutputIdsByJobId = {},
  onSelectOutput,
  bulkActions,
}) => {
  const { flatJobs, garmentIndexByJobId, garmentSlides } = useMemo(() => {
    const slides = buildGarmentSlides(jobs);
    const flat: Job[] = [];
    const garmentIdx: Record<string, number> = {};
    slides.forEach((slide, sIdx) => {
      slide.jobs.forEach((job) => {
        if (job.id) {
          garmentIdx[job.id] = sIdx;
        }
        flat.push(job);
      });
    });
    return { flatJobs: flat, garmentIndexByJobId: garmentIdx, garmentSlides: slides };
  }, [jobs]);

  const [activeJobIndex, setActiveJobIndex] = useState(() => {
    if (initialFocusJobId) {
      const idx = flatJobs.findIndex((j) => j.id === initialFocusJobId);
      if (idx >= 0) return idx;
    }
    return 0;
  });
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  );
  const [isTabletRailOpen, setIsTabletRailOpen] = useState(false);
  const [isMobileRailOpen, setIsMobileRailOpen] = useState(false);
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);

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
    if (typeof window === 'undefined') return undefined;

    const syncViewport = () => setViewportWidth(window.innerWidth);

    syncViewport();
    window.addEventListener('resize', syncViewport);

    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  const isMobileViewport = viewportWidth < 768;
  const isTabletViewport = viewportWidth >= 768 && viewportWidth < 1280;
  const isDesktopViewport = viewportWidth >= 1280;

  useEffect(() => {
    if (!isTabletViewport) {
      setIsTabletRailOpen(false);
    }
    if (!isMobileViewport) {
      setIsMobileRailOpen(false);
      setIsMobileDetailsOpen(false);
    }
  }, [isMobileViewport, isTabletViewport]);

  const handleFocusJob = (jobId: string) => {
    const idx = flatJobs.findIndex((j) => j.id === jobId);
    if (idx >= 0) setActiveJobIndex(idx);
  };

  const handleFocusGarment = (targetGarmentIndex: number) => {
    const targetSlide = garmentSlides[targetGarmentIndex];
    if (!targetSlide) return;
    const targetJob = targetSlide.jobs[Math.min(Math.max(poseIdxInGarment, 0), targetSlide.jobs.length - 1)] ?? targetSlide.jobs[0];
    if (targetJob?.id) handleFocusJob(targetJob.id);
  };

  const handlePrevGarment = () => {
    if (garmentIdx <= 0) return;
    handleFocusGarment(garmentIdx - 1);
  };

  const handleNextGarment = () => {
    if (garmentIdx >= garmentSlides.length - 1) return;
    handleFocusGarment(garmentIdx + 1);
  };

  if (!activeJob) return null;

  const activeJobId = activeJob.id!;
  const draft = localDrafts[activeJobId] ?? { provider: activeJob.provider, prompt: activeJob.promptBase || activeJob.finalPrompt || '' };

  const garmentIdx = garmentIndexByJobId[activeJobId] ?? 0;
  const currentSlide = garmentSlides[garmentIdx];
  const poseIdxInGarment = currentSlide ? currentSlide.jobs.findIndex((j) => j.id === activeJobId) : 0;

  const sharedPoseViewProps = {
    batch,
    job: activeJob,
    poseIndex: poseIdxInGarment,
    garmentIndex: garmentIdx,
    totalGarments: garmentSlides.length,
    draft,
    isQueueing: !!queueingJobs[activeJobId],
    isCancellingGeneration: !!cancellingJobs[activeJobId],
    regenerationError: regenerationErrors[activeJobId] ?? null,
    cancellationError: cancellationErrors[activeJobId] ?? null,
    onUpdateDraft: (updates: Partial<{ provider: typeof draft.provider; prompt: string }>) => updateDraft(activeJobId, updates),
    onRegenerate: () => handleRegenerate(activeJobId),
    onCancelGeneration: () => handleCancelGeneration(activeJobId),
    selectedOutputId: selectedOutputIdsByJobId[activeJobId] ?? null,
    onSelectOutput: onSelectOutput ? (outputId: string | null, output: JobOutput | null) => onSelectOutput(activeJobId, outputId, output) : undefined,
    onPrev: () => setActiveJobIndex((prev) => Math.max(0, prev - 1)),
    onNext: () => setActiveJobIndex((prev) => Math.min(flatJobs.length - 1, prev + 1)),
    onPrevGarment: handlePrevGarment,
    onNextGarment: handleNextGarment,
    canGoPrev: safeIndex > 0,
    canGoNext: safeIndex < flatJobs.length - 1,
    canGoPrevGarment: garmentIdx > 0,
    canGoNextGarment: garmentIdx < garmentSlides.length - 1,
  };

  return (
    <div className="flex flex-col gap-3">
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

      <div
        className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        style={{ height: 'calc(100vh - 9rem)' }}
      >
        {(isTabletViewport || isMobileViewport) ? (
          <>
            {isMobileViewport ? (
              <button
                type="button"
                onClick={() => {
                  setIsMobileDetailsOpen((current) => !current);
                  setIsMobileRailOpen(false);
                }}
                aria-label={isMobileDetailsOpen ? 'Ocultar detalles' : 'Mostrar detalles'}
                title={isMobileDetailsOpen ? 'Ocultar detalles' : 'Mostrar detalles'}
                className={`absolute left-0 top-3 z-30 inline-flex h-14 w-14 items-center justify-center rounded-r-2xl border border-slate-200/70 border-l-0 shadow-xl shadow-slate-950/30 backdrop-blur-md transition ${
                  isMobileDetailsOpen
                    ? 'bg-white text-slate-900'
                    : 'bg-slate-950/76 text-white/92 hover:bg-slate-900/88'
                }`}
              >
                <List className="h-5 w-5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (isTabletViewport) {
                  setIsTabletRailOpen((current) => !current);
                } else {
                  setIsMobileRailOpen((current) => !current);
                  setIsMobileDetailsOpen(false);
                }
              }}
              aria-label={(isTabletViewport ? isTabletRailOpen : isMobileRailOpen) ? 'Ocultar prendas' : 'Mostrar prendas'}
              title={(isTabletViewport ? isTabletRailOpen : isMobileRailOpen) ? 'Ocultar prendas' : 'Mostrar prendas'}
              className={`absolute right-0 top-3 z-30 inline-flex h-14 w-14 items-center justify-center rounded-l-2xl border border-slate-200/70 border-r-0 shadow-xl shadow-slate-950/30 backdrop-blur-md transition ${
                (isTabletViewport ? isTabletRailOpen : isMobileRailOpen)
                  ? 'bg-white text-slate-900'
                  : 'bg-slate-950/76 text-white/92 hover:bg-slate-900/88'
              }`}
            >
              <Shirt className="h-5 w-5" />
            </button>
          </>
        ) : null}

        {isDesktopViewport ? (
          <div className="grid h-full min-w-0 grid-cols-[minmax(0,9fr)_minmax(0,9fr)_minmax(6rem,2fr)]">
            <div className="min-w-0 col-span-2">
              <PoseView {...sharedPoseViewProps} layoutMode="desktop" />
            </div>
            <GarmentRail
              garmentSlides={garmentSlides}
              activeIndex={garmentIdx}
              activePoseIndex={poseIdxInGarment}
              onSelect={handleFocusGarment}
              mode="desktop"
            />
          </div>
        ) : (
          <>
            <PoseView
              {...sharedPoseViewProps}
              layoutMode={isTabletViewport ? 'tablet' : 'mobile'}
              showDetailsOverlay={isMobileDetailsOpen}
              onCloseDetailsOverlay={() => setIsMobileDetailsOpen(false)}
            />
            {(isTabletRailOpen || isMobileRailOpen) ? (
              <div className="absolute inset-y-0 right-0 z-20 w-[6.75rem] bg-white/95 shadow-2xl backdrop-blur-sm">
                <GarmentRail
                  garmentSlides={garmentSlides}
                  activeIndex={garmentIdx}
                  activePoseIndex={poseIdxInGarment}
                  onSelect={(index) => {
                    handleFocusGarment(index);
                    setIsTabletRailOpen(false);
                    setIsMobileRailOpen(false);
                  }}
                  mode="drawer"
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      <CollapsibleTraceability batch={batch} job={activeJob} />
    </div>
  );
};
