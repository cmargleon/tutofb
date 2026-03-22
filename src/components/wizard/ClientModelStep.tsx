import React from 'react';
import { Check, Layers3 } from 'lucide-react';
import { Client, Model } from '../../../shared/src/types';
import { EmptyState, ImageThumb } from '../ui';

interface Props {
  clients: Client[];
  models: Model[];
  selectedClientId: string | null;
  selectedModelId: string | null;
  selectedPoseIds: string[];
  selectedModel: Model | null;
  allPosesSelected: boolean | null | undefined;
  onClientChange: (clientId: string | null) => void;
  onModelSelect: (modelId: string | null) => void;
  onPoseToggle: (poseId: string) => void;
  onToggleAllPoses: () => void;
}

export const ClientModelStep: React.FC<Props> = ({
  clients,
  models,
  selectedClientId,
  selectedModelId,
  selectedPoseIds,
  selectedModel,
  allPosesSelected,
  onClientChange,
  onModelSelect,
  onPoseToggle,
  onToggleAllPoses,
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
            <p className="text-sm text-slate-500">Selecciona un modelo y después las poses que entran al lote.</p>
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

    {selectedModel && (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Poses del modelo</h2>
            <p className="text-sm text-slate-500">
              {selectedPoseIds.length} seleccionada{selectedPoseIds.length === 1 ? '' : 's'} de {selectedModel.poses.length}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleAllPoses}
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {allPosesSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {selectedModel.poses.map((pose) => {
            const selected = selectedPoseIds.includes(pose.id);
            return (
              <button
                type="button"
                key={pose.id}
                onClick={() => onPoseToggle(pose.id)}
                className={`relative overflow-hidden rounded-3xl border transition ${
                  selected ? 'border-emerald-600 ring-2 ring-emerald-600/20' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="aspect-[3/4] bg-slate-100">
                  <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                </div>
                <div className="flex items-center justify-between px-3 py-3 text-left">
                  <div>
                    <p className="text-sm font-medium text-slate-900 line-clamp-1">{pose.fileName}</p>
                    <p className="text-xs text-slate-500">Pose {pose.id.slice(0, 6)}</p>
                  </div>
                  {selected && (
                    <span className="rounded-full bg-emerald-600 p-1 text-white">
                      <Check className="w-4 h-4" />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    )}
  </div>
);
