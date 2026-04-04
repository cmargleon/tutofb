import React, { useEffect, useMemo, useState } from 'react';
import { Batch, Job, JobOutput } from '../../../shared/src/types';
import { useGarmentCarousel } from '../../features/evaluation/useGarmentCarousel';
import { GarmentCarouselControls } from './GarmentCarouselControls';
import { JobEvaluationCard } from './JobEvaluationCard';
import { useJobRegenerationFirebase } from '../../features/evaluation/useJobRegenerationFirebase';
import { FloatingGarmentPreview } from './FloatingGarmentPreview';
import { CheckSquare2, Keyboard, Square } from 'lucide-react';
import { JobTraceabilityPanel } from './JobTraceabilityPanel';
import { BatchErrorLogPanel } from './BatchErrorLogPanel';

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
  keyboardShortcutLabel?: string;
}

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const JobBatchCarousel: React.FC<Props> = ({
  batch,
  jobs,
  initialFocusJobId = null,
  showFloatingGarment = false,
  headerContent,
  selectedJobIds = [],
  selectedOutputIdsByJobId = {},
  onToggleJob,
  onSelectJobs,
  onSelectOutput,
  bulkActions,
  keyboardShortcutLabel = 'Usa flechas izquierda/derecha para cambiar de prenda.',
}) => {
  const { slides, activeSlideIndex, activeSlide, nextSlide, prevSlide, goToSlide } = useGarmentCarousel(jobs, initialFocusJobId);
  const {
    localDrafts,
    queueingJobs,
    regenerationErrors,
    retryingAutoReviewJobs,
    autoReviewRetryErrors,
    cancellingJobs,
    cancellationErrors,
    initializeDraft,
    updateDraft,
    handleRegenerate,
    handleRetryAutoReview,
    handleCancelGeneration,
  } = useJobRegenerationFirebase();

  // Initialize drafts for jobs in the active slide
  useEffect(() => {
    if (activeSlide) {
      activeSlide.jobs.forEach(job => initializeDraft(job));
    }
  }, [activeSlide, initializeDraft]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prevSlide();
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        nextSlide();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nextSlide, prevSlide]);

  const [focusedJobId, setFocusedJobId] = useState<string | null>(initialFocusJobId);

  useEffect(() => {
    if (initialFocusJobId) {
      setFocusedJobId(initialFocusJobId);
    }
  }, [initialFocusJobId]);

  const activeFocusedJob = useMemo(
    () => activeSlide?.jobs.find((job) => job.id === focusedJobId) || activeSlide?.jobs[0] || null,
    [activeSlide, focusedJobId],
  );

  useEffect(() => {
    if (activeSlide && !activeSlide.jobs.some((job) => job.id === focusedJobId)) {
      setFocusedJobId(activeSlide.jobs[0]?.id || null);
    }
  }, [activeSlide, focusedJobId]);

  const handleFocusJob = (jobId: string) => {
    const targetSlideIndex = slides.findIndex((slide) => slide.jobs.some((job) => job.id === jobId));
    if (targetSlideIndex >= 0) {
      goToSlide(targetSlideIndex);
    }
    setFocusedJobId(jobId);
  };

  if (!activeSlide) return null;

  const activeSlideJobIds = activeSlide.jobs.map((job) => job.id).filter((jobId): jobId is string => Boolean(jobId));
  const allActiveSelected = activeSlideJobIds.length > 0 && activeSlideJobIds.every((jobId) => selectedJobIds.includes(jobId));
  const carouselControls = (
    <GarmentCarouselControls
      slides={slides}
      activeIndex={activeSlideIndex}
      onNext={nextSlide}
      onPrev={prevSlide}
      onGoTo={goToSlide}
      embedded={Boolean(headerContent)}
    />
  );

  return (
    <div className="flex flex-col space-y-8">
      {headerContent ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {headerContent}
          <div className="mt-6 border-t border-slate-200 pt-6">
            {carouselControls}
          </div>
        </div>
      ) : (
        carouselControls
      )}

      <BatchErrorLogPanel
        jobs={jobs}
        focusedJobId={activeFocusedJob?.id || null}
        onFocusJob={handleFocusJob}
      />

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">{activeSlide.garmentName}</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <Keyboard className="h-3.5 w-3.5" />
              {keyboardShortcutLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onSelectJobs ? (
              <button
                type="button"
                onClick={() => onSelectJobs(activeSlideJobIds, !allActiveSelected)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                {allActiveSelected ? <CheckSquare2 className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {allActiveSelected ? 'Quitar selección de la prenda' : 'Seleccionar toda la prenda'}
              </button>
            ) : null}
            {bulkActions}
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {activeSlide.jobs.map((job, index) => (
              <JobEvaluationCard
                key={job.id}
                batch={batch}
                job={job}
                index={index}
                draft={localDrafts[job.id!] || { provider: job.provider, prompt: job.promptBase || job.finalPrompt || '' }}
                isQueueing={!!queueingJobs[job.id!]}
                isRetryingAutoReview={!!retryingAutoReviewJobs[job.id!]}
                isCancellingGeneration={!!cancellingJobs[job.id!]}
                regenerationError={regenerationErrors[job.id!] || null}
                autoReviewRetryError={autoReviewRetryErrors[job.id!] || null}
                cancellationError={cancellationErrors[job.id!] || null}
                onUpdateDraft={(updates) => updateDraft(job.id!, updates)}
                onRegenerate={() => handleRegenerate(job.id!)}
                onRetryAutoReview={() => handleRetryAutoReview(job.id!)}
                onCancelGeneration={() => handleCancelGeneration(job.id!)}
                selected={job.id ? selectedJobIds.includes(job.id) : false}
                onToggleSelected={job.id && onToggleJob ? () => onToggleJob(job.id!) : undefined}
                focused={job.id === activeFocusedJob?.id}
                onFocusTraceability={job.id ? () => handleFocusJob(job.id!) : undefined}
                selectedOutputId={job.id ? selectedOutputIdsByJobId[job.id] || null : null}
                onSelectOutput={job.id && onSelectOutput ? (outputId, output) => onSelectOutput(job.id!, outputId, output) : undefined}
              />
            ))}
          </div>

          {activeFocusedJob ? <JobTraceabilityPanel batch={batch} job={activeFocusedJob} /> : null}
        </div>
      </div>

      {showFloatingGarment ? (
        <FloatingGarmentPreview
          garmentName={activeSlide.garmentName}
          storagePath={activeSlide.garmentFilePath}
        />
      ) : null}
    </div>
  );
};
