import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { PROVIDER_LABELS, PROVIDER_VALUES } from '../../../shared/src/domain';
import { Provider } from '../../../shared/src/types';
import { Button } from '../ui';

const KEEP_CURRENT_PROVIDER = '__keep_current_provider__';

interface RetryFailedJobsDialogProps {
  failedJobsCount: number;
  isSubmitting: boolean;
  isOpen: boolean;
  scopeLabel: string;
  disabledProviders?: string[];
  onClose: () => void;
  onSubmit: (provider: Provider | null) => void | Promise<void>;
}

export const RetryFailedJobsDialog: React.FC<RetryFailedJobsDialogProps> = ({
  failedJobsCount,
  isSubmitting,
  isOpen,
  scopeLabel,
  disabledProviders,
  onClose,
  onSubmit,
}) => {
  const [selectedValue, setSelectedValue] = useState<string>(KEEP_CURRENT_PROVIDER);

  const providerOptions = useMemo(
    () => PROVIDER_VALUES.map((provider) => ({
      value: provider,
      disabled: Boolean(disabledProviders?.includes(provider)),
    })),
    [disabledProviders],
  );

  useEffect(() => {
    if (!isOpen) {
      setSelectedValue(KEEP_CURRENT_PROVIDER);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedValue !== KEEP_CURRENT_PROVIDER && disabledProviders?.includes(selectedValue)) {
      setSelectedValue(KEEP_CURRENT_PROVIDER);
    }
  }, [disabledProviders, selectedValue]);

  if (!isOpen) {
    return null;
  }

  const selectedProvider = selectedValue === KEEP_CURRENT_PROVIDER ? null : selectedValue as Provider;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 p-4 sm:items-center"
      onClick={isSubmitting ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="retry-failed-dialog-title"
        className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
          <div>
            <h2 id="retry-failed-dialog-title" className="text-lg font-semibold text-slate-900">
              Reintentar fallidos
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Vas a reencolar {failedJobsCount} job{failedJobsCount === 1 ? '' : 's'} fallido{failedJobsCount === 1 ? '' : 's'} en {scopeLabel}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Modelo IA para los reintentos
            </label>
            <select
              value={selectedValue}
              onChange={(event) => setSelectedValue(event.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value={KEEP_CURRENT_PROVIDER}>Mantener el modelo actual de cada job</option>
              {providerOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {PROVIDER_LABELS[option.value]}{option.disabled ? ' (deshabilitado)' : ''}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">
              Los modelos deshabilitados siguen visibles solo como referencia y no se pueden elegir.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
              Qué va a pasar
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {selectedProvider
                ? `Todos los jobs fallidos seleccionados se reencolarán usando ${PROVIDER_LABELS[selectedProvider]}.`
                : 'Cada job conservará el modelo con el que fue generado originalmente.'}
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-5 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            variant="warning"
            onClick={() => void onSubmit(selectedProvider)}
            loading={isSubmitting}
          >
            Reintentar fallidos
          </Button>
        </div>
      </div>
    </div>
  );
};
