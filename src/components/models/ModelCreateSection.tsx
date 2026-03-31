import React from 'react';
import { ImagePlus, Plus, Upload, Wand2 } from 'lucide-react';
import { Client } from '../../../shared/src/types';
import { UseModelCreateFlowResult } from '../../features/models/hooks/useModelCreateFlow';
import { MODEL_INPUT_BASE } from '../../features/models/utils';
import { ModelAiWizard } from './ModelAiWizard';
import { ModelReferenceForm } from './ModelReferenceForm';
import { ModelUploadForm } from './ModelUploadForm';
import { SelectField } from './SelectField';

interface ModelCreateSectionProps {
  clients: Client[];
  loading: boolean;
  flow: UseModelCreateFlowResult;
}

export const ModelCreateSection: React.FC<ModelCreateSectionProps> = ({
  clients,
  loading,
  flow,
}) => {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-medium text-gray-900">
        <Plus className="h-5 w-5 text-indigo-600" />
        Nuevo modelo
      </h2>

      {flow.shared.error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {flow.shared.error}
        </div>
      )}

      {clients.length === 0 && !loading ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Debes crear al menos un cliente antes de poder registrar un modelo.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="client" className="mb-1.5 block text-sm font-medium text-gray-700">
                Cliente
              </label>
              <SelectField
                id="client"
                value={flow.shared.selectedClientId}
                onChange={(event) => flow.shared.setSelectedClientId(event.target.value)}
                disabled={flow.shared.inputsDisabled}
              >
                <option value="">Selecciona un cliente...</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </SelectField>
            </div>
            <div>
              <label
                htmlFor="model-name"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Nombre del modelo
              </label>
              <input
                id="model-name"
                type="text"
                value={flow.shared.newModelName}
                onChange={(event) => flow.shared.setNewModelName(event.target.value)}
                className={MODEL_INPUT_BASE}
                placeholder="Ej. Modelo Femenino 1"
                disabled={flow.shared.inputsDisabled}
              />
            </div>
          </div>

          <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => flow.shared.setCreateTab('upload')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                flow.shared.createTab === 'upload'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Upload className="h-4 w-4" /> Subir fotos
            </button>
            <button
              type="button"
              onClick={() => flow.shared.setCreateTab('generate')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                flow.shared.createTab === 'generate'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Wand2 className="h-4 w-4" /> Generar con IA
            </button>
            <button
              type="button"
              onClick={() => flow.shared.setCreateTab('reference')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                flow.shared.createTab === 'reference'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <ImagePlus className="h-4 w-4" /> Partir de foto real
            </button>
          </div>

          {flow.shared.createTab === 'upload' ? (
            <ModelUploadForm shared={flow.shared} upload={flow.upload} />
          ) : flow.shared.createTab === 'generate' ? (
            <ModelAiWizard shared={flow.shared} ai={flow.ai} />
          ) : (
            <ModelReferenceForm shared={flow.shared} reference={flow.reference} />
          )}
        </div>
      )}
    </div>
  );
};
