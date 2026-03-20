import { useState, useMemo } from 'react';
import { Job } from '../../../shared/src/types';
import { buildGarmentSlides, GarmentSlide } from './jobSlides';

export const useGarmentCarousel = (jobs: Job[]) => {
  const slides = useMemo(() => buildGarmentSlides(jobs), [jobs]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

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
