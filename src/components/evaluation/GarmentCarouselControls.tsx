import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GarmentSlide } from '../../features/evaluation/jobSlides';
import { ImageThumb } from '../ui';

interface Props {
  slides: GarmentSlide[];
  activeIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onGoTo: (index: number) => void;
}

export const GarmentCarouselControls: React.FC<Props> = ({
  slides,
  activeIndex,
  onNext,
  onPrev,
  onGoTo
}) => {
  if (slides.length <= 1) return null;

  return (
    <div className="flex flex-col items-center space-y-4 mb-8">
      <div className="flex items-center space-x-4">
        <button
          onClick={onPrev}
          disabled={activeIndex === 0}
          className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-6 h-6 text-gray-600" />
        </button>
        
        <div className="text-sm font-medium text-gray-700">
          Prenda {activeIndex + 1} de {slides.length} · {slides[activeIndex].jobs.length} poses
        </div>

        <button
          onClick={onNext}
          disabled={activeIndex === slides.length - 1}
          className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-6 h-6 text-gray-600" />
        </button>
      </div>

      <div className="flex space-x-2 overflow-x-auto max-w-full pb-2 px-4">
        {slides.map((slide, idx) => (
          <button
            key={slide.garmentId}
            onClick={() => onGoTo(idx)}
            className={`relative w-16 h-16 rounded-md overflow-hidden flex-shrink-0 border-2 transition-all ${
              idx === activeIndex ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-transparent hover:border-gray-300'
            }`}
            title={slide.garmentName}
          >
            <ImageThumb storagePath={slide.garmentFilePath} alt={slide.garmentName} />
          </button>
        ))}
      </div>
    </div>
  );
};
