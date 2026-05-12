import React, { useMemo } from 'react';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';

interface FloatingGarmentPreviewProps {
  garmentName: string;
  storagePath: string;
}

export const FloatingGarmentPreview: React.FC<FloatingGarmentPreviewProps> = ({
  garmentName,
  storagePath,
}) => {
  const { url, loading } = useStorageAssetUrl(storagePath);

  const previewTitle = useMemo(
    () => (garmentName?.trim() ? garmentName.trim() : 'Prenda de referencia'),
    [garmentName],
  );

  if (loading || !url) {
    return null;
  }

  return (
    <div className="floating-garment-preview pointer-events-none fixed bottom-4 z-30 hidden sm:block">
      <div className="pointer-events-auto group relative" tabIndex={0}>
        <div className="w-24 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-lg backdrop-blur transition group-hover:-translate-y-1 group-hover:shadow-xl group-focus-within:-translate-y-1 group-focus-within:shadow-xl">
          <div className="absolute -top-2 right-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600 shadow-sm">
            Ref
          </div>
          <div className="flex h-24 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
            <img
              src={url}
              alt={previewTitle}
              className="max-h-full w-full object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="mt-2">
            <span className="line-clamp-2 text-left text-[11px] font-medium leading-4 text-slate-700">
              {previewTitle}
            </span>
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-0 left-0 origin-bottom-left opacity-0 transition duration-200 group-hover:opacity-100 group-hover:[transform:translateY(0)_scale(1)] group-focus-within:opacity-100 group-focus-within:[transform:translateY(0)_scale(1)] [transform:translateY(8px)_scale(0.92)]">
          <div className="w-[21.6rem] rounded-[1.75rem] border border-slate-200 bg-white p-3 shadow-2xl">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-600">
              Prenda de referencia
            </p>
            <div className="overflow-hidden rounded-[1.25rem] bg-slate-100 p-3">
              <img
                src={url}
                alt={previewTitle}
                className="h-[26.4rem] w-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-800">{previewTitle}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
