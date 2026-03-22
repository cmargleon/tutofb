import React from 'react';
import { FolderUp, ImagePlus, UploadCloud, X } from 'lucide-react';
import { EmptyState } from '../ui';
import { GarmentUploadState, UploadedGarmentDraft } from '../../features/generate/types';

const getUploadStatusCopy = (upload: GarmentUploadState): { label: string; tone: string; bar: string } => {
  switch (upload.status) {
    case 'queued':
      return { label: 'En cola', tone: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400' };
    case 'uploading':
      return { label: 'Subiendo', tone: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500' };
    case 'retrying':
      return { label: `Reintento ${Math.max(upload.attempts, 1)}`, tone: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' };
    case 'uploaded':
      return { label: 'Lista', tone: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' };
    case 'failed':
      return { label: 'Falló', tone: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500' };
    case 'idle':
    default:
      return { label: 'Pendiente', tone: 'bg-slate-100 text-slate-600', bar: 'bg-slate-300' };
  }
};

interface Props {
  garments: UploadedGarmentDraft[];
  isSubmitting: boolean;
  onFiles: (files: File[]) => Promise<void>;
  onRemoveGarment: (id: string) => void;
}

export const GarmentsStep: React.FC<Props> = ({ garments, isSubmitting, onFiles, onRemoveGarment }) => (
  <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-2">
      <label className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition ${
        isSubmitting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-950 hover:bg-slate-50'
      }`}>
        <UploadCloud className="mb-3 h-8 w-8 text-slate-500" />
        <span className="text-sm font-semibold text-slate-900">Archivos individuales</span>
        <span className="mt-1 text-sm text-slate-500">Cada imagen suelta entra como una prenda.</span>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={isSubmitting}
          className="hidden"
          onChange={async (event) => {
            const files = Array.from(event.target.files || []) as File[];
            await onFiles(files);
            event.target.value = '';
          }}
        />
      </label>

      <label className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition ${
        isSubmitting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-950 hover:bg-slate-50'
      }`}>
        <FolderUp className="mb-3 h-8 w-8 text-slate-500" />
        <span className="text-sm font-semibold text-slate-900">Carpeta de prendas</span>
        <span className="mt-1 text-sm text-slate-500">
          Raíz suelta = una prenda multiángulo. Subcarpetas = una prenda por subcarpeta.
        </span>
        <input
          type="file"
          {...({ webkitdirectory: '', directory: '' } as any)}
          disabled={isSubmitting}
          className="hidden"
          onChange={async (event) => {
            const files = Array.from(event.target.files || []) as File[];
            await onFiles(files);
            event.target.value = '';
          }}
        />
      </label>
    </div>

    {garments.length === 0 ? (
      <EmptyState
        title="Todavía no hay prendas en el lote"
        description="Sube archivos sueltos o una carpeta para componer automáticamente las prendas del wizard."
        icon={<ImagePlus className="w-6 h-6" />}
      />
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {garments.map((garment) => (
          <div key={garment.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="relative aspect-square bg-slate-100">
              <img src={garment.previewUrl} alt={garment.name} className="h-full w-full object-contain" />
              <button
                type="button"
                onClick={() => onRemoveGarment(garment.id)}
                disabled={isSubmitting}
                className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-slate-700 shadow-sm transition hover:bg-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{garment.name}</h3>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {garment.isMultiAngle ? 'Multiángulo' : 'Simple'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {garment.files.length} archivo{garment.files.length === 1 ? '' : 's'} · {garment.sourceType}
              </p>
              {garment.upload.status !== 'idle' ? (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className={`rounded-full px-2.5 py-1 font-medium ${getUploadStatusCopy(garment.upload).tone}`}>
                      {getUploadStatusCopy(garment.upload).label}
                    </span>
                    <span className="font-medium text-slate-500">{Math.round(garment.upload.progress)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${getUploadStatusCopy(garment.upload).bar}`}
                      style={{ width: `${Math.max(garment.upload.progress, garment.upload.status === 'uploaded' ? 100 : 6)}%` }}
                    />
                  </div>
                  {garment.upload.error ? (
                    <p className="text-xs leading-relaxed text-rose-600">{garment.upload.error}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);
