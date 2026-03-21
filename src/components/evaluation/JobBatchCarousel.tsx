import React, { useEffect } from 'react';
import { Batch, Job } from '../../../shared/src/types';
import { useGarmentCarousel } from '../../features/evaluation/useGarmentCarousel';
import { GarmentCarouselControls } from './GarmentCarouselControls';
import { JobEvaluationCard } from './JobEvaluationCard';
import { useJobRegenerationFirebase } from '../../features/evaluation/useJobRegenerationFirebase';
import { FloatingGarmentPreview } from './FloatingGarmentPreview';

interface Props {
  batch: Batch;
  jobs: Job[];
  showFloatingGarment?: boolean;
}

export const JobBatchCarousel: React.FC<Props> = ({ batch, jobs, showFloatingGarment = false }) => {
  const { slides, activeSlideIndex, activeSlide, nextSlide, prevSlide, goToSlide } = useGarmentCarousel(jobs);
  const {
    localDrafts,
    queueingJobs,
    regenerationErrors,
    initializeDraft,
    updateDraft,
    handleRegenerate
  } = useJobRegenerationFirebase(jobs);

  // Initialize drafts for jobs in the active slide
  useEffect(() => {
    if (activeSlide) {
      activeSlide.jobs.forEach(job => initializeDraft(job));
    }
  }, [activeSlide, initializeDraft]);

  if (!activeSlide) return null;

  return (
    <div className="flex flex-col space-y-8">
      <GarmentCarouselControls
        slides={slides}
        activeIndex={activeSlideIndex}
        onNext={nextSlide}
        onPrev={prevSlide}
        onGoTo={goToSlide}
      />

      <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {activeSlide.jobs.map((job, index) => (
            <JobEvaluationCard
              key={job.id}
              batch={batch}
              job={job}
              index={index}
              draft={localDrafts[job.id!] || { provider: job.provider, prompt: job.promptBase || job.finalPrompt || '' }}
              isQueueing={!!queueingJobs[job.id!]}
              regenerationError={regenerationErrors[job.id!] || null}
              onUpdateDraft={(updates) => updateDraft(job.id!, updates)}
              onRegenerate={() => handleRegenerate(job.id!)}
            />
          ))}
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
