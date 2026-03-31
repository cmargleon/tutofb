import React from 'react';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { HoverZoomImage } from '../evaluation/HoverZoomImage';

interface CandidatePhotoCardProps {
  storagePath: string;
  index: number;
  isRegenerating: boolean;
  isSelected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onRegenerate: () => void;
}

export const CandidatePhotoCard: React.FC<CandidatePhotoCardProps> = ({
  storagePath,
  index,
  isRegenerating,
  isSelected,
  disabled = false,
  onSelect,
  onRegenerate,
}) => {
  const { url, loading } = useStorageAssetUrl(storagePath);

  return (
    <div className={`relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-all ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-gray-200'}`}>
      <div className="aspect-[3/4] bg-gray-100 relative overflow-hidden">
        {isRegenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90">
            <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin mb-2" />
            <p className="text-xs text-gray-500">Regenerando...</p>
          </div>
        ) : loading ? (
          <div className="absolute inset-0 animate-pulse bg-gray-200" />
        ) : url ? (
          <HoverZoomImage src={url} alt={`Generada ${index + 1}`} containerClassName="absolute inset-0" imageClassName="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-400" />
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
          Candidato {index + 1}
        </span>
        {isSelected && !isRegenerating && (
          <span className="absolute right-2 top-2 rounded-full bg-emerald-500/90 p-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-white" />
          </span>
        )}
      </div>
      <div className="flex gap-1 p-2">
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled}
          className={`flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
            isSelected
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
          }`}
        >
          {isSelected ? 'Modelo base elegido' : 'Elegir este modelo'}
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={disabled || isRegenerating}
          className="cursor-pointer rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
          title="Regenerar esta foto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
