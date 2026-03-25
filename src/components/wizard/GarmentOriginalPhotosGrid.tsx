import React from 'react';
import { GarmentOriginalPhotoDraft } from '../../features/generate/types';

interface Props {
  photos: GarmentOriginalPhotoDraft[];
  showClassification?: boolean;
  className?: string;
}

const formatViewLabel = (photo: GarmentOriginalPhotoDraft, showClassification: boolean): string => {
  if (!showClassification) {
    return `Foto ${photo.sourceIndex + 1}`;
  }

  switch (photo.classification.status) {
    case 'classified':
      switch (photo.classification.view) {
        case 'front':
          return 'Frente';
        case 'back':
          return 'Espalda';
        case 'side':
          return 'Costado';
        default:
          return 'Clasificada';
      }
    case 'classifying':
      return 'Analizando';
    case 'failed':
      return 'Sin clasificar';
    case 'idle':
    default:
      return `Foto ${photo.sourceIndex + 1}`;
  }
};

const getBadgeTone = (photo: GarmentOriginalPhotoDraft, showClassification: boolean): string => {
  if (!showClassification) {
    return 'bg-white/90 text-slate-700';
  }

  switch (photo.classification.status) {
    case 'classified':
      switch (photo.classification.view) {
        case 'front':
          return 'bg-emerald-100 text-emerald-800';
        case 'back':
          return 'bg-indigo-100 text-indigo-800';
        case 'side':
          return 'bg-amber-100 text-amber-800';
        default:
          return 'bg-slate-100 text-slate-700';
      }
    case 'classifying':
      return 'bg-sky-100 text-sky-800';
    case 'failed':
      return 'bg-rose-100 text-rose-800';
    case 'idle':
    default:
      return 'bg-white/90 text-slate-700';
  }
};

export const GarmentOriginalPhotosGrid: React.FC<Props> = ({
  photos,
  showClassification = false,
  className = '',
}) => {
  const visiblePhotos = photos.slice(0, 4);
  const photoCount = visiblePhotos.length;
  const gridClassName =
    photoCount <= 1
      ? 'grid-cols-1'
      : photoCount === 2
        ? 'grid-cols-2'
        : 'grid-cols-2';

  return (
    <div className={`grid ${gridClassName} gap-2 ${className}`.trim()}>
      {visiblePhotos.map((photo, index) => {
        const isSingle = photoCount === 1;
        const isHeroInThreePhotoLayout = photoCount === 3 && index === 0;

        return (
          <div
            key={photo.id}
            className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white ${
              isSingle ? 'aspect-square' : isHeroInThreePhotoLayout ? 'col-span-2 aspect-[2/1]' : 'aspect-square'
            }`}
          >
            <img src={photo.previewUrl} alt={photo.fileName} className="h-full w-full object-contain" />
            <span
              className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-medium shadow-sm ${getBadgeTone(photo, showClassification)}`}
            >
              {formatViewLabel(photo, showClassification)}
            </span>
          </div>
        );
      })}
    </div>
  );
};
