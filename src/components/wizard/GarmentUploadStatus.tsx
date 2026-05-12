import React from 'react';
import { GarmentUploadState } from '../../features/generate/types';
import {
  getGarmentUploadProgressValue,
  getGarmentUploadStatusCopy,
} from '../../features/generate/wizard/state';

interface GarmentUploadStatusProps {
  upload: GarmentUploadState;
  minimumProgress?: number;
}

export const GarmentUploadStatus: React.FC<GarmentUploadStatusProps> = ({
  upload,
  minimumProgress = 4,
}) => {
  const uploadCopy = getGarmentUploadStatusCopy(upload);

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={`rounded-full px-2.5 py-1 font-medium ${uploadCopy.tone}`}>
          {uploadCopy.label}
        </span>
        <span className="font-medium text-slate-500">{Math.round(upload.progress)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <progress
          className={`garment-upload-progress ${uploadCopy.bar}`}
          max={100}
          value={getGarmentUploadProgressValue(upload, minimumProgress)}
          aria-label={`Progreso de subida: ${Math.round(upload.progress)}%`}
        />
      </div>
      {upload.error ? (
        <p className="text-xs leading-relaxed text-rose-600">{upload.error}</p>
      ) : null}
    </div>
  );
};
