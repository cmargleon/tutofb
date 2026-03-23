import React from 'react';
import { JobOutput } from '../../../shared/src/types';
import { ImageIcon } from 'lucide-react';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';

interface Props {
  output: JobOutput;
  label: string;
  onSelect: () => void;
  active: boolean;
  userApproved: boolean;
  disabled?: boolean;
}

export const AttemptThumbnail: React.FC<Props> = ({
  output,
  label,
  active,
  userApproved,
  disabled = false,
  onSelect,
}) => {
  const { url } = useStorageAssetUrl(output.resultImagePath || null);
  const verdict = output.autoReview?.verdict || null;
  const statusLabel = userApproved
    ? 'Aprobada por usuario'
    : verdict === 'approved'
      ? 'Aprobada por Gemini'
      : verdict === 'rejected'
        ? 'Rechazada'
        : 'Sin veredicto';

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`group shrink-0 rounded-2xl border p-1.5 text-left transition ${
        userApproved
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
        {output.isCurrent ? (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-slate-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Actual
          </span>
        ) : null}
        {userApproved ? (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Elegida
          </span>
        ) : null}
      </div>
      <div className="mt-2 space-y-1 px-0.5">
        <p className="text-[11px] font-semibold text-slate-700">{label}</p>
        <p
          className={`text-[11px] ${
            userApproved || verdict === 'approved'
              ? 'text-emerald-700'
              : verdict === 'rejected'
                ? 'text-amber-700'
                : 'text-slate-500'
          }`}
        >
          {statusLabel}
        </p>
      </div>
    </button>
  );
};
