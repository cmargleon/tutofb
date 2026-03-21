import React from 'react';
import { ImageThumb } from '../ui';

interface ActiveGarmentThumbnailProps {
  currentIndex: number;
  totalItems: number;
  garmentName: string;
  poseCount: number;
  storagePath: string;
}

export const ActiveGarmentThumbnail: React.FC<ActiveGarmentThumbnailProps> = ({
  currentIndex,
  totalItems,
  garmentName,
  poseCount,
  storagePath,
}) => (
  <div className="grid justify-items-center gap-4 text-center">
    <div className="rounded-[1.4rem] border border-indigo-200 bg-white p-2 shadow-md shadow-slate-200/70">
      <div className="h-20 w-14 overflow-hidden rounded-[1rem] bg-slate-50 sm:h-24 sm:w-16">
        <ImageThumb
          storagePath={storagePath}
          alt={garmentName}
          fit="contain"
          imgClassName="bg-white p-1"
        />
      </div>
    </div>

    <div className="space-y-1">
      <p className="text-sm font-medium text-slate-700">
        Prenda {currentIndex + 1} de {totalItems} · {poseCount} pose{poseCount === 1 ? '' : 's'}
      </p>
      <p className="max-w-[18rem] text-sm text-slate-500">{garmentName}</p>
    </div>
  </div>
);
