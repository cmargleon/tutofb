import React from 'react';
import { Layers3 } from 'lucide-react';
import { Client, Model } from '../../../shared/src/types';
import { EmptyState, ImageThumb } from '../ui';

interface Props {
  clients: Client[];
  models: Model[];
  selectedClientId: string | null;
  selectedModelId: string | null;
  onClientChange: (clientId: string | null) => void;
  onModelSelect: (modelId: string | null) => void;
}

export const ClientModelStep: React.FC<Props> = ({
  clients,
  models,
  selectedClientId,
  selectedModelId,
  onClientChange,
  onModelSelect,
}) => (
  <div className="space-y-6">
    <div className="grid gap-5 lg:grid-cols-[280px,1fr]">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="mb-2 block text-sm font-medium text-slate-700">Cliente</label>
        <select
          value={selectedClientId || ''}
          onChange={(event) => onClientChange(event.target.value || null)}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none"
        >
          <option value="">Selecciona un cliente</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Modelos del cliente</h2>
            <p className="text-sm text-slate-500">
              Elige el modelo primero. Las poses se sugerirán después de subir las prendas.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {models.length} modelo{models.length === 1 ? '' : 's'}
          </span>
        </div>

        {!selectedClientId ? (
          <EmptyState
            title="Primero elige un cliente"
            description="Cuando selecciones una marca aparecerán aquí sus modelos disponibles."
            icon={<Layers3 className="w-6 h-6" />}
          />
        ) : models.length === 0 ? (
          <EmptyState
            title="Este cliente aún no tiene modelos"
            description="Crea un modelo con poses antes de continuar con el lote."
            icon={<Layers3 className="w-6 h-6" />}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {models.map((model) => {
              const coverPath = model.coverPosePath || model.poses[0]?.storagePath;
              const isSelected = model.id === selectedModelId;
              return (
                <button
                  type="button"
                  key={model.id}
                  onClick={() => onModelSelect(model.id || null)}
                  className={`overflow-hidden rounded-3xl border text-left transition ${
                    isSelected
                      ? 'border-emerald-700 bg-emerald-600 text-white shadow-lg shadow-emerald-900/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                  }`}
                >
                  <div className="aspect-[4/3] bg-slate-100">
                    {coverPath ? (
                      <ImageThumb storagePath={coverPath} alt={model.name} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-400">Sin preview</div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className={`font-semibold ${isSelected ? 'text-white' : 'text-slate-900'}`}>{model.name}</h3>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          isSelected ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {model.poseCount} poses
                      </span>
                    </div>
                    <p className={`mt-2 text-sm ${isSelected ? 'text-emerald-100' : 'text-slate-500'}`}>
                      {model.clientNameSnapshot}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  </div>
);
