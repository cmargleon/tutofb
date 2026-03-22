import React from 'react';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { HoverZoomImage } from '../evaluation/HoverZoomImage';

interface GeneratedPoseCardProps {
  storagePath: string;
  label: string;
  hint?: string;
  rejected: boolean;
  isRegenerating: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  onReject: () => void;
  onAccept: () => void;
  onRegenerate?: () => void;
}

export const GeneratedPoseCard: React.FC<GeneratedPoseCardProps> = ({
  storagePath,
  label,
  hint,
  rejected,
  isRegenerating,
  isLoading = false,
  disabled = false,
  onReject,
  onAccept,
  onRegenerate,
}) => {
  const { url, loading: urlLoading } = useStorageAssetUrl(storagePath);

  return (
    <div className={`relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-all ${rejected ? 'opacity-40 grayscale' : 'border-gray-200'}`}>
      <div className="aspect-[3/4] bg-gray-100 relative overflow-hidden" title={hint}>
        {(isRegenerating || isLoading) ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90">
            <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin mb-2" />
            <p className="text-xs text-gray-500">{isLoading ? 'Generando...' : 'Regenerando...'}</p>
          </div>
        ) : urlLoading ? (
          <div className="absolute inset-0 animate-pulse bg-gray-200" />
        ) : url ? (
          <HoverZoomImage src={url} alt={label} containerClassName="absolute inset-0" imageClassName="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-400" />
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
          {label}
        </span>
        {!rejected && !isRegenerating && (
          <span className="absolute right-2 top-2 rounded-full bg-emerald-500/90 p-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-white" />
          </span>
        )}
      </div>
      <div className="flex gap-1 p-2">
        {rejected ? (
          <button
            type="button"
            onClick={onAccept}
            disabled={disabled}
            className="flex-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50"
          >
            Incluir
          </button>
        ) : (
          <button
            type="button"
            onClick={onReject}
            disabled={disabled}
            className="flex-1 rounded-lg bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-50"
          >
            Quitar
          </button>
        )}
        {onRegenerate ? (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={disabled || isRegenerating}
            className="rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-100 transition disabled:opacity-50"
            title="Regenerar esta pose"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div className="rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] font-medium text-gray-400">
            Pose base
          </div>
        )}
      </div>
    </div>
  );
};
