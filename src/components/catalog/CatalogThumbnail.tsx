import React, { useEffect, useState } from 'react';
import { Ban, Loader2 } from 'lucide-react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../firebase';
import { Job } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';

interface CatalogThumbnailProps {
  job: Job;
  onClick: (job: Job) => void;
}

export const CatalogThumbnail: React.FC<CatalogThumbnailProps> = ({ job, onClick }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const resultPath = resolveApprovedJobOutput(job)?.resultImagePath;
  const isGenerating = job.status === 'pending' || job.status === 'processing';
  const isFailed = job.status === 'failed';

  useEffect(() => {
    setUrl(null);
    setLoadError(false);
    if (!resultPath) return;
    let cancelled = false;
    getDownloadURL(ref(storage, resultPath))
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [resultPath]);

  // Failed job with a generated photo: show photo with dark mask
  if (isFailed && url) {
    return (
      <button
        type="button"
        onClick={() => onClick(job)}
        className="relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border border-rose-300 bg-gray-100 transition-colors hover:border-rose-400"
        title={job.garmentName}
      >
        <img
          src={url}
          alt={job.garmentName}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {/* Dark mask overlay */}
        <div className="absolute inset-0 bg-black/55" />
        {/* Failure badge */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
          <Ban className="h-8 w-8 text-rose-300" aria-hidden="true" />
          <p className="text-sm font-semibold text-white leading-tight">La generación falló</p>
        </div>
      </button>
    );
  }

  // Failed job with NO generated photo (or still loading URL): just icon, no spinner
  if (isFailed) {
    return (
      <button
        type="button"
        onClick={() => onClick(job)}
        className="relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border border-rose-200 bg-rose-50 transition-colors hover:border-rose-300"
        title={job.garmentName}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center bg-gradient-to-br from-rose-50 via-rose-100 to-rose-200">
          <Ban className="h-8 w-8 text-rose-400" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-rose-800">La generación falló</p>
            <p className="line-clamp-3 text-xs text-rose-600">
              {job.lastError?.trim() || 'Abre el detalle para revisar el error.'}
            </p>
          </div>
        </div>
      </button>
    );
  }

  // Completed with photo
  if (url) {
    return (
      <button
        type="button"
        onClick={() => onClick(job)}
        className="relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition-colors hover:border-indigo-400"
        title={job.garmentName}
      >
        <img
          src={url}
          alt={job.garmentName}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />
      </button>
    );
  }

  // Generating / loading URL placeholder (spinner)
  const statusLabel = isGenerating
    ? job.status === 'processing' ? 'Generando' : 'En cola'
    : loadError ? 'Sin vista previa' : 'Cargando';

  return (
    <button
      type="button"
      onClick={() => onClick(job)}
      className="relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition-colors hover:border-indigo-400"
      title={job.garmentName}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center bg-gradient-to-br from-slate-100 via-slate-100 to-slate-200">
        {loadError ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700">Vista previa no disponible</p>
            <p className="text-xs text-slate-500">Abre el modal para revisar el estado.</p>
          </div>
        ) : (
          <>
            <Loader2 className="h-7 w-7 animate-spin text-indigo-500" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-700">{statusLabel}</p>
              <p className="text-xs text-slate-500">
                {isGenerating ? 'Puedes abrirla mientras termina de salir.' : 'La miniatura todavía se está cargando.'}
              </p>
            </div>
          </>
        )}
      </div>
    </button>
  );
};
