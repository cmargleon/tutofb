import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
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
  const shouldShowImage = Boolean(url) && !isFailed;
  const statusLabel = isGenerating
    ? job.status === 'processing'
      ? 'Generando'
      : 'En cola'
    : isFailed
      ? 'Falló'
    : resultPath && !loadError
      ? 'Cargando'
      : 'Sin vista previa';

  useEffect(() => {
    setUrl(null);
    setLoadError(false);
    if (!resultPath || isFailed) return;
    let cancelled = false;
    getDownloadURL(ref(storage, resultPath))
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [isFailed, resultPath]);

  return (
    <button
      type="button"
      onClick={() => onClick(job)}
      className={`relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border transition-colors ${
        isFailed
          ? 'border-rose-200 bg-rose-50 hover:border-rose-300'
          : 'border-gray-200 bg-gray-100 hover:border-indigo-400'
      }`}
      title={job.garmentName}
    >
      {shouldShowImage ? (
        <img
          src={url}
          alt={job.garmentName}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />
      ) : (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center ${
            isFailed
              ? 'bg-gradient-to-br from-rose-50 via-rose-100 to-rose-200'
              : 'bg-gradient-to-br from-slate-100 via-slate-100 to-slate-200'
          }`}
        >
          {isGenerating || (resultPath && !loadError) ? (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-indigo-500" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-700">{statusLabel}</p>
                <p className="text-xs text-slate-500">
                  {isGenerating ? 'Puedes abrirla mientras termina de salir.' : 'La miniatura todavía se está cargando.'}
                </p>
              </div>
            </>
          ) : isFailed ? (
            <>
              <AlertTriangle className="h-7 w-7 text-rose-500" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-rose-800">La generación falló</p>
                <p className="line-clamp-3 text-xs text-rose-700">
                  {job.lastError?.trim() || 'Abre el detalle para revisar el error y relanzar la foto.'}
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-700">Vista previa no disponible</p>
              <p className="text-xs text-slate-500">Abre el modal para revisar el estado del job.</p>
            </div>
          )}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-2">
        <p className="text-white text-xs truncate">{job.modelNameSnapshot}</p>
        {!shouldShowImage ? <p className="text-[11px] text-white/80">{statusLabel}</p> : null}
      </div>
    </button>
  );
};
