import React from 'react';
import { UploadedGarmentDraft, UploadSummary } from '../../features/generate/types';
import { getGarmentUploadStatusCopy } from '../../features/generate/wizard/state';
import { GarmentUploadStatus } from './GarmentUploadStatus';

interface BatchUploadSummaryProps {
  garments: UploadedGarmentDraft[];
  uploadSummary: UploadSummary;
}

export const BatchUploadSummary: React.FC<BatchUploadSummaryProps> = ({
  garments,
  uploadSummary,
}) => (
  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <label className="block text-sm font-medium text-slate-700">Estado de subida</label>
        <p className="mt-1 text-sm text-slate-500">
          Las prendas exitosas quedan guardadas y un reintento solo vuelve a subir las pendientes o fallidas.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-medium">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">{uploadSummary.uploaded} listas</span>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
          {uploadSummary.inFlight + uploadSummary.queued} en proceso
        </span>
        <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-700">{uploadSummary.failed} con error</span>
      </div>
    </div>

    {garments.length > 0 ? (
      <div className="mt-4 space-y-2">
        {garments.map((garment) => (
          <div key={`upload-summary-${garment.id}`} className="rounded-2xl bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{garment.name}</p>
                <p className="text-xs text-slate-500">
                  {Math.round(garment.upload.progress)}% · intento {Math.max(garment.upload.attempts, 1)}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${getGarmentUploadStatusCopy(garment.upload).tone}`}>
                {getGarmentUploadStatusCopy(garment.upload).label}
              </span>
            </div>
            <GarmentUploadStatus upload={garment.upload} />
          </div>
        ))}
      </div>
    ) : null}
  </div>
);
