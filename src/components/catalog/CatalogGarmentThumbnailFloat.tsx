import React, { useEffect, useMemo, useState } from 'react';
import { Job } from '../../../shared/src/types';
import { HoverZoomImage } from '../evaluation/HoverZoomImage';
import { resolveStorageAssetUrl } from '../../features/storage/assets';

export const CatalogGarmentThumbnailFloat: React.FC<{ job: Job }> = ({ job }) => {
  const paths = useMemo(
    () => (job.garmentFilePath ? [job.garmentFilePath] : []),
    [job.garmentFilePath],
  );

  const [urls, setUrls] = useState<(string | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(paths.map((path) => resolveStorageAssetUrl(path).then((result) => result.url).catch(() => null))).then((results) => {
      if (!cancelled) setUrls(results);
    });
    return () => { cancelled = true; };
  }, [paths]);

  const loadedUrls = urls.filter(Boolean) as string[];

  if (loadedUrls.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 z-30 flex flex-col items-start gap-1.5 isolate" onClick={(e) => e.stopPropagation()}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">Prenda</p>
      <div className="flex flex-col gap-1.5">
        {loadedUrls.map((url, i) => (
          <div key={`${url}-${i}`} className="group relative">
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-400/70"
              aria-label={`Ver prenda de referencia${loadedUrls.length > 1 ? ` ${i + 1}` : ''}`}
            >
              <img
                src={url}
                alt={`${job.garmentName}${loadedUrls.length > 1 ? ` referencia ${i + 1}` : ''}`}
                className="h-20 w-auto cursor-zoom-in rounded-xl border border-white/10 bg-white/90 object-contain shadow-lg transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-xl group-focus-within:-translate-y-0.5 group-focus-within:shadow-xl"
                referrerPolicy="no-referrer"
              />
            </button>

            <div className="pointer-events-none absolute bottom-0 left-full ml-3 z-40 origin-bottom-left opacity-0 transition duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:[transform:translateY(0)_scale(1)] group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-focus-within:[transform:translateY(0)_scale(1)] [transform:translateY(8px)_scale(0.96)]">
              <div className="w-[18rem] rounded-[1.4rem] border border-white/10 bg-slate-950/92 p-3 shadow-2xl shadow-black/45 backdrop-blur-md">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300">
                  Prenda de referencia
                </p>
                <HoverZoomImage
                  src={url}
                  alt={`${job.garmentName}${loadedUrls.length > 1 ? ` referencia ${i + 1}` : ''}`}
                  containerClassName="h-[25rem] w-full rounded-[1rem] bg-white"
                  imageClassName="h-full w-full object-contain"
                  preserveNaturalAspectRatio
                />
                <p className="mt-3 text-sm font-medium text-white/90">{job.garmentName}</p>
                {loadedUrls.length > 1 ? (
                  <p className="mt-1 text-xs text-white/60">Vista {i + 1} de {loadedUrls.length}</p>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
