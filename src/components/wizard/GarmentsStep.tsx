import React from 'react';
import { FolderUp, ImagePlus, UploadCloud, X } from 'lucide-react';
import { EmptyState } from '../ui';
import { UploadedGarmentDraft, WizardState } from '../../features/generate/types';
import { GarmentUploadStatus } from './GarmentUploadStatus';
import { GarmentOriginalPhotosGrid } from './GarmentOriginalPhotosGrid';

interface Props {
  generationKind: WizardState['generationKind'];
  excludedItemsNotice: string | null;
  onGenerationKindChange: (kind: NonNullable<WizardState['generationKind']>) => void;
  onRetryAnalysis: () => void;
  onSameItemFiles?: (files: File[]) => Promise<void>;
  garments: UploadedGarmentDraft[];
  isSubmitting: boolean;
  onFiles: (files: File[]) => Promise<void>;
  onRemoveGarment: (id: string) => void;
}

export const GarmentsStep: React.FC<Props> = ({ garments, isSubmitting, onFiles, onRemoveGarment, generationKind, excludedItemsNotice, onGenerationKindChange, onRetryAnalysis, onSameItemFiles }) => (
  <div className="space-y-6">
    <div>
      <h2 className="text-lg font-semibold text-slate-900">Sube tus productos</h2>
      <p className="mt-1 text-sm text-slate-500">Detectaremos si el lote es de ropa u objetos. Hasta 4 referencias por artículo y 40 fotos por lote.</p>
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      <label className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition ${
        isSubmitting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-950 hover:bg-slate-50'
      }`}>
        <UploadCloud className="mb-3 h-8 w-8 text-slate-500" />
        <span className="text-sm font-semibold text-slate-900">Archivos individuales</span>
        <span className="mt-1 text-sm text-slate-500">Cada imagen representa un artículo independiente.</span>
        <input
          type="file"
          aria-label="Fotos de artículos independientes"
          accept="image/jpeg,image/png,image/webp"
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
        <span className="text-sm font-semibold text-slate-900">Carpeta de productos</span>
        <span className="mt-1 text-sm text-slate-500">
          Una carpeta por artículo, con hasta 4 fotos del mismo producto.
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
      <label className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-emerald-300 bg-emerald-50 px-6 py-10 text-center ${isSubmitting ? 'opacity-60' : 'cursor-pointer hover:border-emerald-600'}`}>
        <ImagePlus className="mb-3 h-8 w-8 text-emerald-700" />
        <span className="text-sm font-semibold text-slate-900">Varias fotos del mismo artículo</span>
        <span className="mt-1 text-sm text-emerald-700">Selecciona hasta 4 referencias para crear un solo artículo.</span>
        <input type="file" aria-label="Fotos del mismo artículo" multiple accept="image/jpeg,image/png,image/webp" className="hidden" disabled={isSubmitting}
          onChange={async (event) => { const input = event.currentTarget; await onSameItemFiles?.(Array.from(input.files || [])); input.value = ''; }} />
      </label>
    </div>

    {excludedItemsNotice && <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{excludedItemsNotice}</p>}
    {garments.some((garment) => garment.analysisStatus === 'preparing') && <p role="status" className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">Analizando fotos… Estamos detectando el tipo de artículo y sus vistas.</p>}
    {garments.some((garment) => garment.analysisStatus === 'failed') && <div role="alert" className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <p>Algunas fotos no se pudieron analizar. Las referencias subidas se conservarán.</p>
      <button type="button" disabled={isSubmitting} onClick={onRetryAnalysis} className="rounded-xl border border-rose-300 bg-white px-4 py-2 font-semibold">Reintentar análisis</button>
    </div>}
    {garments.length > 0 && garments.every((garment) => garment.analysisStatus === 'ready') && <div className="space-y-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
      <p role="status" className="text-sm font-semibold text-slate-900">{generationKind === 'garment' ? 'Lote de ropa · Prepararemos fotos con modelo' : generationKind === 'product' ? 'Lote de objetos · Prepararemos escenas de producto' : 'Confirma cómo quieres fotografiar este lote'}</p>
      <details open={!generationKind || undefined}>
        <summary className="cursor-pointer text-sm text-emerald-800">Cambiar tipo de fotografía</summary>
        <p className="mt-3 text-xs text-slate-600">Puedes corregir la detección o fotografiar una prenda como producto. Conservaremos todas tus referencias.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={isSubmitting} aria-pressed={generationKind === 'garment'} onClick={() => onGenerationKindChange('garment')} className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900">Ropa con modelo</button>
          <button type="button" disabled={isSubmitting} aria-pressed={generationKind === 'product'} onClick={() => onGenerationKindChange('product')} className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900">Fotografía de producto</button>
        </div>
      </details>
    </div>}

    {garments.length === 0 ? (
      <EmptyState
        title="Todavía no hay fotos en el lote"
        description="Sube fotos individuales o agrupa varias referencias del mismo artículo. Gemini identificará el tipo de producto automáticamente."
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
                {garment.analysisStatus === 'ready' ? `${garment.itemKind === 'garment' ? 'Prenda' : garment.itemKind === 'product' ? 'Objeto' : 'Tipo por confirmar'}${garment.itemLabel ? ` · ${garment.itemLabel}` : ''}` : garment.analysisStatus === 'failed' ? 'Análisis pendiente de reintento' : 'Pendiente de análisis'}
              </p>
              {garment.itemKindReasoning && <p className="text-xs text-slate-500">{garment.itemKindReasoning}</p>}
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
