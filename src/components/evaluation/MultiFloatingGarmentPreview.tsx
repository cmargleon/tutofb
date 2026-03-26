import React, { useMemo } from 'react';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';

// Loads URL for a single path — used for expansion panel images
const GarmentImg: React.FC<{ url: string; alt: string; style?: React.CSSProperties }> = ({ url, alt, style }) => (
  <img src={url} alt={alt} className="h-full flex-1 object-contain" style={style} referrerPolicy="no-referrer" />
);

// Secondary image loader (for expanded multi-angle view)
const SecondaryGarmentImg: React.FC<{ storagePath: string; alt: string }> = ({ storagePath, alt }) => {
  const { url } = useStorageAssetUrl(storagePath);
  if (!url) return <div className="h-full flex-1 bg-slate-100 rounded-xl" />;
  return <GarmentImg url={url} alt={alt} />;
};

interface Props {
  garmentName: string;
  storagePaths: string[];
}

export const MultiFloatingGarmentPreview: React.FC<Props> = ({ garmentName, storagePaths }) => {
  const title = useMemo(
    () => (garmentName?.trim() ? garmentName.trim() : 'Prenda de referencia'),
    [garmentName],
  );

  // Primary image — drives whether to show the component at all (mirrors original behaviour)
  const primaryPath = storagePaths[0] ?? null;
  const { url: primaryUrl, loading } = useStorageAssetUrl(primaryPath);

  if (loading || !primaryUrl) return null;

  const isMulti = storagePaths.length > 1;
  // Expanded width: 14rem per image, max 48rem
  const expandedWidthRem = Math.min(storagePaths.length * 14, 48);

  return (
    <div
      className="pointer-events-none fixed bottom-4 z-30 hidden sm:block"
      style={{ left: 'calc(var(--app-sidebar-width, 0rem) + 1rem)' }}
    >
      <div className="pointer-events-auto group relative" tabIndex={0}>
        {/* ── Thumbnail (collapsed) ── */}
        <div
          className="rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-lg backdrop-blur transition group-hover:-translate-y-1 group-hover:shadow-xl group-focus-within:-translate-y-1 group-focus-within:shadow-xl"
          style={{ width: isMulti ? `${Math.min(storagePaths.length * 3.5 + 3, 14)}rem` : '6rem' }}
        >
          <div className="absolute -top-2 right-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600 shadow-sm">
            Ref
          </div>
          <div className="flex h-24 items-center gap-1 overflow-hidden rounded-xl bg-slate-100 p-1">
            <img
              src={primaryUrl}
              alt={title}
              className="h-full flex-1 object-contain"
              referrerPolicy="no-referrer"
            />
            {isMulti
              ? storagePaths.slice(1).map((path, i) => (
                  <SecondaryGarmentImg key={path} storagePath={path} alt={`${title} ángulo ${i + 2}`} />
                ))
              : null}
          </div>
          <div className="mt-1.5">
            <span className="line-clamp-2 text-left text-[11px] font-medium leading-4 text-slate-700">
              {title}
            </span>
          </div>
        </div>

        {/* ── Expanded (hover) ── */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 origin-bottom-left opacity-0 transition duration-200 group-hover:opacity-100 group-hover:[transform:translateY(0)_scale(1)] group-focus-within:opacity-100 group-focus-within:[transform:translateY(0)_scale(1)] [transform:translateY(8px)_scale(0.92)]"
        >
          <div
            className="rounded-[1.75rem] border border-slate-200 bg-white p-3 shadow-2xl"
            style={{ width: `${expandedWidthRem}rem` }}
          >
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-600">
              Prenda de referencia
            </p>
            <div className="flex gap-2 overflow-hidden rounded-[1.25rem] bg-slate-100 p-3" style={{ height: '26.4rem' }}>
              <img
                src={primaryUrl}
                alt={title}
                className="h-full flex-1 object-contain"
                referrerPolicy="no-referrer"
              />
              {isMulti
                ? storagePaths.slice(1).map((path, i) => (
                    <SecondaryGarmentImg key={path} storagePath={path} alt={`${title} ángulo ${i + 2}`} />
                  ))
                : null}
            </div>
            <p className="mt-3 text-sm font-medium text-slate-800">{title}</p>
            {isMulti ? (
              <p className="mt-0.5 text-xs text-slate-500">{storagePaths.length} ángulos de referencia</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
