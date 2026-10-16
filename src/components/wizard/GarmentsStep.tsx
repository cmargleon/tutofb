import React from 'react';
import { FolderUp, ImagePlus, UploadCloud, X } from 'lucide-react';
import { EmptyState } from '../ui';
import { UploadedGarmentDraft } from '../../features/generate/types';
import { GarmentUploadStatus } from './GarmentUploadStatus';
import { GarmentOriginalPhotosGrid } from './GarmentOriginalPhotosGrid';

interface Props {
  productMode?: boolean;
  onSameItemFiles?: (files: File[]) => Promise<void>;
  garments: UploadedGarmentDraft[];
  isSubmitting: boolean;
  onFiles: (files: File[]) => Promise<void>;
  onRemoveGarment: (id: string) => void;
}

export const GarmentsStep: React.FC<Props> = ({ garments, isSubmitting, onFiles, onRemoveGarment, productMode = false, onSameItemFiles }) => (
  <div className="space-y-6">
    <div className={`grid gap-4 ${productMode ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
      <label className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition ${
        isSubmitting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-950 hover:bg-slate-50'
      }`}>
        <UploadCloud className="mb-3 h-8 w-8 text-slate-500" />
        <span className="text-sm font-semibold text-slate-900">Archivos individuales</span>
        <span className="mt-1 text-sm text-slate-500">{productMode ? 'Cada imagen representa un objeto independiente.' : 'Cada imagen suelta entra como una prenda.'}</span>
        <input
          type="file"
          accept={productMode ? 'image/jpeg,image/png,image/webp' : 'image/*'}
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
        <span className="text-sm font-semibold text-slate-900">Carpeta de {productMode ? 'objetos' : 'prendas'}</span>
        <span className="mt-1 text-sm text-slate-500">
          {productMode ? 'Una carpeta por objeto, con hasta 4 fotos del mismo artículo.' : 'Raíz suelta = una prenda con varias fotos relacionadas. Subcarpetas = una prenda por subcarpeta.'}
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
      {productMode && <label className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-emerald-300 bg-emerald-50 px-6 py-10 text-center ${isSubmitting ? 'opacity-60' : 'cursor-pointer hover:border-emerald-600'}`}>
        <ImagePlus className="mb-3 h-8 w-8 text-emerald-700" />
        <span className="text-sm font-semibold text-slate-900">Varias fotos del mismo objeto</span>
        <span className="mt-1 text-sm text-emerald-700">Selecciona hasta 4 referencias para crear un solo artículo.</span>
        <input type="file" aria-label="Fotos del mismo objeto" multiple accept="image/jpeg,image/png,image/webp" className="hidden" disabled={isSubmitting}
          onChange={async (event) => { const input = event.currentTarget; await onSameItemFiles?.(Array.from(input.files || [])); input.value = ''; }} />
      </label>}
    </div>

    {garments.length === 0 ? (
      <EmptyState
        title={productMode ? 'Todavía no hay objetos en el lote' : 'Todavía no hay prendas en el lote'}
        description={productMode ? 'Carga objetos independientes o agrupa varias referencias del mismo artículo. Máximo 40 fotos por lote.' : 'Sube archivos sueltos o una carpeta para componer automáticamente las prendas del wizard.'}
        icon={<ImagePlus className="w-6 h-6" />}
      />
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {garments.map((garment) => (
          <div key={garment.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="relative aspect-square bg-slate-100">
              <div className="h-full w-full p-3">
                <GarmentOriginalPhotosGrid photos={garment.originalPhotos} />
              </div>
              <button
                type="button"
                aria-label={`Quitar ${garment.name}`}
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
                  {garment.originalPhotos.length > 1 ? `${garment.originalPhotos.length} vistas` : '1 vista'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {garment.files.length} archivo{garment.files.length === 1 ? '' : 's'} · {garment.sourceType}
              </p>
              <p className="text-xs text-slate-500">
                {productMode ? 'Todas estas fotos se usarán como referencias del mismo objeto.' : 'Las fotos se conservan por separado para que Gemini detecte frente, espalda o costado.'}
              </p>
              {garment.upload.status !== 'idle' ? (
                <GarmentUploadStatus upload={garment.upload} minimumProgress={6} />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);
