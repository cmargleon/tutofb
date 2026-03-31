import React, { useEffect, useRef } from 'react';
import { buildGarmentSlides } from '../../features/evaluation/jobSlides';
import { ImageThumb } from '../ui';

interface GarmentRailProps {
  garmentSlides: ReturnType<typeof buildGarmentSlides>;
  activeIndex: number;
  activePoseIndex: number;
  onSelect: (garmentIndex: number) => void;
  mode?: 'desktop' | 'drawer';
}

export const GarmentRail: React.FC<GarmentRailProps> = ({
  garmentSlides,
  activeIndex,
  activePoseIndex,
  onSelect,
  mode = 'desktop',
}) => {
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  if (garmentSlides.length === 0) return null;

  return (
    <aside className={`${mode === 'desktop' ? 'hidden xl:flex' : 'flex'} min-h-0 flex-col overflow-visible border-l border-slate-100`}>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-visible px-2 py-4">
        <div className="flex flex-col items-center gap-3">
          {garmentSlides.map((slide, index) => {
            const isActive = index === activeIndex;
            const poseCount = slide.jobs.length;
            const previewJob = slide.jobs[Math.min(activePoseIndex, poseCount - 1)] ?? slide.jobs[0];

            return (
              <button
                key={slide.garmentId}
                ref={isActive ? activeItemRef : null}
                type="button"
                onClick={() => onSelect(index)}
                className={`group relative z-0 w-full max-w-[6.25rem] cursor-pointer overflow-visible rounded-[1.15rem] border bg-white/95 p-1.5 text-left transition duration-200 hover:z-20 ${
                  isActive
                    ? 'border-emerald-400 shadow-md shadow-emerald-100/70'
                    : 'border-slate-200/90 hover:border-slate-300/90 hover:shadow-md'
                }`}
                title={slide.garmentName}
              >
                <div className="overflow-visible rounded-[0.95rem] border border-slate-100 bg-white">
                  <div className="relative h-28 w-full overflow-visible bg-white">
                    <ImageThumb
                      storagePath={previewJob?.garmentFilePath || slide.garmentFilePath}
                      alt={slide.garmentName}
                      fit="contain"
                      imgClassName="relative z-10 bg-white p-1.5 shadow-lg shadow-slate-950/0 transition duration-200 ease-out group-hover:scale-[1.22] group-hover:shadow-xl group-hover:shadow-slate-950/25"
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
