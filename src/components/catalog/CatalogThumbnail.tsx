import React from 'react';
import { Ban, Download, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { Job } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { getCatalogDisplayFailureInfo, isFailureCancellation } from '../../features/catalog/errorMessage';

interface CatalogThumbnailProps {
  job: Job;
  onClick: (job: Job) => void;
  onRegenerate?: (job: Job) => void;
  onCancel?: (job: Job) => void;
  onDownload?: (job: Job) => void;
  onDelete?: (job: Job) => void;
  regenerationPending?: boolean;
  cancellationPending?: boolean;
}

export const CatalogThumbnail: React.FC<CatalogThumbnailProps> = ({
  job,
  onClick,
  onRegenerate,
  onCancel,
  onDownload,
  onDelete,
  regenerationPending = false,
  cancellationPending = false,
}) => {
  const approvedOutput = resolveApprovedJobOutput(job);
  const resultPath = approvedOutput?.resultImagePath;
  const isGenerating = job.status === 'pending' || job.status === 'processing';
  const failureInfo = getCatalogDisplayFailureInfo(job, approvedOutput);
  const isFailed = Boolean(failureInfo);
  const isCancelled = isFailureCancellation(failureInfo);
  const failureMessage = failureInfo?.userMessage || failureInfo?.technicalMessage || failureInfo?.title || 'Abre el detalle para revisar el error.';
  const { url, error } = useStorageAssetUrl(resultPath || null);
  const loadError = Boolean(error);
  const showRegenerationOverlay = regenerationPending && Boolean(url);
  const showCancelAction = Boolean(onCancel) && (regenerationPending || isGenerating);

  const actionButtons = (showCancelAction || (!regenerationPending && (onRegenerate || onDownload || onDelete))) ? (
    <div className="absolute bottom-0 inset-x-0 flex justify-center gap-1 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      {showCancelAction ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCancel?.(job); }}
          className="rounded-full p-1.5 bg-black/35 hover:bg-black/65 text-white hover:text-rose-300 transition-colors"
          title={cancellationPending ? 'Cancelando...' : 'Cancelar regeneración'}
        >
          {cancellationPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
        </button>
      ) : null}
      {!showCancelAction && onRegenerate && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRegenerate(job); }}
          className="rounded-full p-1.5 bg-black/35 hover:bg-black/65 text-white transition-colors"
          title="Regenerar"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      )}
      {!showCancelAction && onDownload && resultPath && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDownload(job); }}
          className="rounded-full p-1.5 bg-black/35 hover:bg-black/65 text-white transition-colors"
          title="Descargar"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      )}
      {!showCancelAction && onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(job); }}
          className="rounded-full p-1.5 bg-black/35 hover:bg-black/65 text-white hover:text-rose-300 transition-colors"
          title="Borrar"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  ) : null;

  // Failed job with a generated photo: show photo with dark mask
  if (isFailed && url) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick(job)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(job); }}
        className="relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border border-rose-300 bg-gray-100 transition-colors hover:border-rose-400"
        title={job.garmentName}
      >
        <img
          src={url}
          alt={job.garmentName}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {showRegenerationOverlay ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 px-3 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-white" aria-hidden="true" />
            <p className="text-sm font-semibold text-white leading-tight">Regenerando foto...</p>
          </div>
        ) : (
          <>
            <div className="absolute inset-0 bg-black/55" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
              {isCancelled ? (
                <XCircle className="h-8 w-8 text-amber-200" aria-hidden="true" />
              ) : (
                <Ban className="h-8 w-8 text-rose-300" aria-hidden="true" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white leading-tight">
                  {isCancelled ? 'Regeneración cancelada' : 'La generación falló'}
                </p>
                <p className={`line-clamp-3 text-xs ${isCancelled ? 'text-amber-50' : 'text-rose-100'}`}>
                  {failureMessage}
                </p>
              </div>
            </div>
          </>
        )}
        {actionButtons}
      </div>
    );
  }

  // Failed job with NO generated photo (or still loading URL): just icon, no spinner
  if (isFailed) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick(job)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(job); }}
        className={`relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg transition-colors ${
          isCancelled
            ? 'border border-amber-200 bg-amber-50 hover:border-amber-300'
            : 'border border-rose-200 bg-rose-50 hover:border-rose-300'
        }`}
        title={job.garmentName}
      >
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center ${
            isCancelled
              ? 'bg-gradient-to-br from-amber-50 via-amber-100 to-amber-200'
              : 'bg-gradient-to-br from-rose-50 via-rose-100 to-rose-200'
          }`}
        >
          {isCancelled ? (
            <XCircle className="h-8 w-8 text-amber-500" aria-hidden="true" />
          ) : (
            <Ban className="h-8 w-8 text-rose-400" aria-hidden="true" />
          )}
          <div className="space-y-1">
            <p className={`text-sm font-semibold ${isCancelled ? 'text-amber-900' : 'text-rose-800'}`}>
              {isCancelled ? 'Regeneración cancelada' : 'La generación falló'}
            </p>
            <p className={`line-clamp-3 text-xs ${isCancelled ? 'text-amber-700' : 'text-rose-600'}`}>
              {failureMessage}
            </p>
          </div>
        </div>
        {actionButtons}
      </div>
    );
  }

  // Completed with photo
  if (url) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick(job)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(job); }}
        className="relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition-colors hover:border-indigo-400"
        title={job.garmentName}
      >
        <img
          src={url}
          alt={job.garmentName}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />
        {showRegenerationOverlay ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 px-3 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-white" aria-hidden="true" />
            <p className="text-sm font-semibold text-white leading-tight">Regenerando foto...</p>
          </div>
        ) : null}
        {actionButtons}
      </div>
    );
  }

  // Generating / loading URL placeholder (spinner)
  const statusLabel = isGenerating
    ? job.status === 'processing' ? 'Generando' : 'En cola'
    : regenerationPending ? 'Regenerando' : loadError ? 'Sin vista previa' : 'Cargando';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(job)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(job); }}
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
                {isGenerating || regenerationPending
                  ? 'Puedes abrirla mientras termina de salir.'
                  : 'La miniatura todavía se está cargando.'}
              </p>
            </div>
          </>
        )}
      </div>
      {actionButtons}
    </div>
  );
};
