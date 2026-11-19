import React from 'react';
import { ImageOff } from 'lucide-react';
import type { CatalogPhoto } from '../../../../shared/src/types';
import { useCatalogPreviewUrl } from '../../../features/catalog/useCatalogPreviewUrl';
import { useStorageAssetUrl } from '../../../features/storage/useStorageAssetUrl';

/** Thumbnail of a catalog photo (falls back to the full image when the thumbnail is missing). */
export const CatalogProductPhoto: React.FC<{ photo: CatalogPhoto | null; alt: string; className?: string; full?: boolean }> = ({ photo, alt, className = '', full = false }) => {
  const preview = useCatalogPreviewUrl(photo && !full ? { resultImagePath: photo.storagePath, thumbnailPath: photo.thumbnailPath || undefined } : null);
  const original = useStorageAssetUrl(photo && full ? photo.storagePath : null);
  const { url, loading } = full ? original : preview;
  const frame = `relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 ${className}`;
  if (!photo) {
    return <div className={`${frame} flex flex-col items-center justify-center gap-1 text-[11px] text-slate-400`}><ImageOff className="h-4 w-4" aria-hidden="true" />Sin foto</div>;
  }
  if (loading || !url) return <div className={`${frame} app-skeleton`} aria-label="Cargando foto" />;
  return <div className={frame}>
    <img src={url} alt={alt} loading="lazy" className={`h-full w-full ${full ? 'object-contain' : 'object-cover'}`} />
    {!photo.approved && <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">Sin aprobar</span>}
  </div>;
};
