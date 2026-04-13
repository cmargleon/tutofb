import React from 'react';
import { X } from 'lucide-react';
import { Client } from '../../../shared/src/types';
import { Button } from '../ui';

interface ModelImportDialogProps {
  clients: Client[];
  selectedClientId: string;
  onClientChange: (value: string) => void;
  selectedFile: File | null;
  onFileChange: (file: File | null) => void;
  isImporting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

export const ModelImportDialog: React.FC<ModelImportDialogProps> = ({
  clients,
  selectedClientId,
  onClientChange,
  selectedFile,
  onFileChange,
  isImporting,
  onClose,
  onSubmit,
}) => (
  <div
    className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 p-4 sm:items-center"
    onClick={isImporting ? undefined : onClose}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-import-dialog-title"
      className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-2xl"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
        <div>
          <h2 id="model-import-dialog-title" className="text-lg font-semibold text-slate-900">
            Importar modelo
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Sube un ZIP exportado desde la biblioteca de modelos para recrear fotos y metadata en un cliente destino.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isImporting}
          className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-5 p-6">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Cliente destino
          </label>
          <select
            value={selectedClientId}
            onChange={(event) => onClientChange(event.target.value)}
            disabled={isImporting || clients.length === 0}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">Selecciona un cliente…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Archivo ZIP
          </label>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center transition hover:border-slate-400 hover:bg-slate-100">
            <input
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              disabled={isImporting}
              onChange={(event) => onFileChange(event.target.files?.[0] || null)}
            />
            <span className="text-sm font-medium text-slate-900">
              {selectedFile ? selectedFile.name : 'Elegir ZIP exportado'}
            </span>
            <span className="mt-2 text-xs text-slate-500">
              Debe incluir `manifest.json` y la carpeta `poses/`.
            </span>
          </label>
          {selectedFile ? (
            <p className="mt-2 text-xs text-slate-500">
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-5 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={isImporting}
        >
          Cancelar
        </Button>
        <Button
          onClick={onSubmit}
          loading={isImporting}
          disabled={!selectedClientId || !selectedFile || clients.length === 0}
        >
          Importar modelo
        </Button>
      </div>
    </div>
  </div>
);
