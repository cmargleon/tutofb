import React from 'react';
import { JobOutput } from '../../../shared/src/types';
import { ImageIcon } from 'lucide-react';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';

interface Props {
  output: JobOutput;
  label: string;
  onSelect: () => void;
  active: boolean;
  effectivelySelected: boolean;
  geminiApproved: boolean;
  disabled?: boolean;
}

export const AttemptThumbnail: React.FC<Props> = ({
  output,
  label,
  active,
  effectivelySelected,
  geminiApproved,
  disabled = false,
  onSelect,
}) => {
  const { url } = useStorageAssetUrl(output.resultImagePath || null);
  const checkIcon = geminiApproved
    ? effectivelySelected
      ? '✅'
      : '☑️'
    : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`group shrink-0 rounded-2xl border p-1.5 text-left transition ${
        effectivelySelected
          ? 'border-emerald-300 bg-emerald-50 shadow-sm'
          : active
            ? 'border-indigo-300 bg-indigo-50 shadow-sm'
            : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
      } ${disabled ? 'cursor-wait opacity-70' : ''}`}
      title={label}
    >
      <div className="relative h-20 w-16 overflow-hidden rounded-xl bg-slate-100">
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <ImageIcon className="h-4 w-4" />
          </div>
        )}
        {checkIcon ? (
          <span
            className={`absolute bottom-1.5 left-1.5 rounded-full px-1.5 py-0.5 text-[11px] leading-none ${
              effectivelySelected ? 'bg-emerald-600/90 text-white' : 'bg-slate-700/75 text-white'
            }`}
            aria-label={
              effectivelySelected
                ? 'Salida aprobada por Gemini y seleccionada'
                : 'Salida aprobada por Gemini'
            }
          >
            {checkIcon}
          </span>
        ) : null}
      </div>
      <div className="mt-2 px-0.5">
        <p className="text-[11px] font-semibold text-slate-700">{label}</p>
      </div>
    </button>
  );
};
