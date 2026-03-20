import React, { useEffect } from 'react';
import { Batch, Job } from '../../../shared/src/types';
import { useGarmentCarousel } from '../../features/evaluation/useGarmentCarousel';
import { GarmentCarouselControls } from './GarmentCarouselControls';
import { JobEvaluationCard } from './JobEvaluationCard';
import { useJobRegenerationFirebase } from '../../features/evaluation/useJobRegenerationFirebase';

interface Props {
  batch: Batch;
  jobs: Job[];
}

export const JobBatchCarousel: React.FC<Props> = ({ batch, jobs }) => {
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

      <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <span className="bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full text-sm mr-3">
              Prenda {activeSlideIndex + 1}
            </span>
            {activeSlide.garmentName}
          </h2>
          <span className="text-sm text-gray-500 font-medium">
            {activeSlide.jobs.length} poses
          </span>
        </div>

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
    </div>
  );
};
