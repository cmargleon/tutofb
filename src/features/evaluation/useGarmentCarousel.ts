import { useEffect, useMemo, useState } from 'react';
import { Job } from '../../../shared/src/types';
import { buildGarmentSlides, GarmentSlide } from './jobSlides';

export const useGarmentCarousel = (jobs: Job[], initialFocusJobId?: string | null) => {
  const slides = useMemo(() => buildGarmentSlides(jobs), [jobs]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  useEffect(() => {
    if (!initialFocusJobId) {
      return;
    }

    const targetSlideIndex = slides.findIndex((slide) =>
      slide.jobs.some((job) => job.id === initialFocusJobId),
    );

    if (targetSlideIndex >= 0) {
      setActiveSlideIndex(targetSlideIndex);
    }
  }, [initialFocusJobId, slides]);

  // Ensure activeSlideIndex is within bounds if slides change
  const safeActiveSlideIndex = Math.min(activeSlideIndex, Math.max(0, slides.length - 1));
  const activeSlide = slides[safeActiveSlideIndex];

  const nextSlide = () => {
    setActiveSlideIndex((prev) => Math.min(prev + 1, slides.length - 1));
  };

  const prevSlide = () => {
    setActiveSlideIndex((prev) => Math.max(prev - 1, 0));
  };

  const goToSlide = (index: number) => {
    setActiveSlideIndex(Math.min(Math.max(0, index), slides.length - 1));
  };

  return {
    slides,
    activeSlideIndex: safeActiveSlideIndex,
    activeSlide,
    nextSlide,
    prevSlide,
    goToSlide
  };
};
