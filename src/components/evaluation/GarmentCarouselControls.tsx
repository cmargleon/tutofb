import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GarmentSlide } from '../../features/evaluation/jobSlides';
import { ActiveGarmentThumbnail } from './ActiveGarmentThumbnail';

interface Props {
  slides: GarmentSlide[];
  activeIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onGoTo: (index: number) => void;
  embedded?: boolean;
}

export const GarmentCarouselControls: React.FC<Props> = ({
  slides,
  activeIndex,
  onNext,
  onPrev,
  onGoTo,
  embedded = false,
}) => {
  const activeSlide = slides[activeIndex] || slides[0];

  if (!activeSlide) return null;

  return (
    <div className={embedded ? '' : 'rounded-[2rem] border border-slate-200 bg-white px-6 py-7 shadow-sm'}>
      <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <button
          onClick={onPrev}
          disabled={activeIndex === 0}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-6 py-4 text-base font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 lg:justify-self-start"
        >
          <span className="inline-flex items-center gap-2">
            <ChevronLeft className="h-5 w-5" />
            Prenda anterior
          </span>
        </button>

        <button
          type="button"
          onClick={() => onGoTo(activeIndex)}
          className="justify-self-center"
          title={activeSlide.garmentName}
        >
          <ActiveGarmentThumbnail
            currentIndex={activeIndex}
            totalItems={slides.length}
            garmentName={activeSlide.garmentName}
            poseCount={activeSlide.jobs.length}
            storagePath={activeSlide.garmentFilePath}
          />
        </button>

        <button
          onClick={onNext}
          disabled={activeIndex === slides.length - 1}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-6 py-4 text-base font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 lg:justify-self-end"
        >
          <span className="inline-flex items-center gap-2">
            Siguiente prenda
            <ChevronRight className="h-5 w-5" />
          </span>
        </button>
      </div>
    </div>
  );
};
