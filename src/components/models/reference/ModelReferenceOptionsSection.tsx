import { IDENTITY_CANDIDATE_COUNT } from '../../../features/models/constants';
import { ProviderCostEstimate } from '../../wizard/ProviderCostEstimate';
import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ModelPhotoProvider } from '../../../../shared/src/types';
import { ModelCreateFlowReferenceState } from '../../../features/models/hooks/useReferenceModelFlow';
import { mapModelPhotoProviderToProvider } from '../../../features/models/providerImageConfig';
import { MODEL_INPUT_BASE } from '../../../features/models/utils';
import { ProviderImageConfigSelection } from '../../wizard/ProviderImageConfigSelection';
import { SelectField } from '../SelectField';

const TOGGLE_BASE =
  'cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

interface ModelReferenceOptionsSectionProps {
  reference: ModelCreateFlowReferenceState;
}

export const ModelReferenceOptionsSection: React.FC<ModelReferenceOptionsSectionProps> = ({
  reference,
}) => (
  <div className="space-y-5">
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Identidad</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={reference.busy}
            onClick={() => reference.setIdentityMode('exact')}
            className={`${TOGGLE_BASE} ${
              reference.identityMode === 'exact'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Igual
          </button>
          <button
            type="button"
            disabled={reference.busy}
            onClick={() => reference.setIdentityMode('similar')}
            className={`${TOGGLE_BASE} ${
              reference.identityMode === 'similar'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Similar
          </button>
        </div>
        <p className="text-xs text-gray-500">
          <strong>Igual</strong> intenta mantener la misma persona. <strong>Similar</strong> crea alguien inspirado en la referencia, pero no idéntico.
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Fondo</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={reference.busy}
            onClick={() => reference.setBackgroundMode('preserve')}
            className={`${TOGGLE_BASE} ${
              reference.backgroundMode === 'preserve'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Mantener
          </button>
          <button
            type="button"
            disabled={reference.busy}
            onClick={() => reference.setBackgroundMode('custom')}
            className={`${TOGGLE_BASE} ${
              reference.backgroundMode === 'custom'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Editar
          </button>
        </div>
      </div>
    </div>

    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">Ropa</label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={reference.busy}
          onClick={() => reference.setClothingMode('preserve')}
          className={`${TOGGLE_BASE} ${
            reference.clothingMode === 'preserve'
              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          Mantener
        </button>
        <button
          type="button"
          disabled={reference.busy}
          onClick={() => reference.setClothingMode('custom')}
          className={`${TOGGLE_BASE} ${
            reference.clothingMode === 'custom'
              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          Cambiar en prompt
        </button>
      </div>
    </div>

    {reference.backgroundMode === 'custom' ? (
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Instrucción para el fondo
        </label>
        <textarea
          value={reference.backgroundPrompt}
          onChange={(event) => reference.setBackgroundPrompt(event.target.value)}
          rows={2}
          className={`${MODEL_INPUT_BASE} resize-none`}
          disabled={reference.busy}
          placeholder="Ej. Fondo gris neutro de estudio con piso visible."
        />
      </div>
    ) : null}

    {reference.clothingMode === 'custom' ? (
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Instrucción para la ropa
        </label>
        <textarea
          value={reference.clothingPrompt}
          onChange={(event) => reference.setClothingPrompt(event.target.value)}
          rows={2}
          className={`${MODEL_INPUT_BASE} resize-none`}
          disabled={reference.busy}
          placeholder="Ej. Remera blanca lisa y pantalón negro de estudio."
        />
      </div>
    ) : null}

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Proveedor IA</label>
        <SelectField
          value={reference.provider}
          onChange={(event) => reference.setProvider(event.target.value as ModelPhotoProvider)}
          disabled={reference.busy}
        >
          {reference.providerOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label} - {option.hint}{option.disabled ? ' · Deshabilitado' : ''}
            </option>
          ))}
        </SelectField>
        {reference.selectedProviderDisabled ? (
          <p className="mt-2 text-xs text-amber-700">
            Este modelo IA está deshabilitado en Configuración. Sigue visible como referencia, pero no se puede usar para generar.
          </p>
        ) : null}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Relación resultante</label>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {reference.aspectRatio}
        </div>
      </div>
    </div>

    <div className={reference.busy ? 'pointer-events-none opacity-60' : undefined}>
      <ProviderImageConfigSelection
        provider={mapModelPhotoProviderToProvider(reference.provider)}
        value={reference.providerImageConfig}
        onChange={reference.setProviderImageConfig}
      />
    </div>

    {reference.identityMode === 'similar' ? (
      <ProviderCostEstimate config={reference.providerImageConfig} imageCount={IDENTITY_CANDIDATE_COUNT} referenceCount={1} />
    ) : null}

    <div>
      <button
        type="button"
        onClick={() => reference.setPromptExpanded((value) => !value)}
        className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
      >
        <span>
          Opciones avanzadas - Prompt de referencia
          {reference.promptEdited ? <span className="ml-2 text-indigo-600">(editado)</span> : null}
        </span>
        {reference.promptExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {reference.promptExpanded ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-end">
            {reference.promptEdited ? (
              <button
                type="button"
                onClick={reference.restoreAutoPrompt}
                className="text-xs text-indigo-600 hover:underline"
              >
                Restaurar automático
              </button>
            ) : null}
          </div>
          <textarea
            value={reference.prompt}
            onChange={(event) => reference.updatePrompt(event.target.value)}
            rows={4}
            className={`${MODEL_INPUT_BASE} resize-none`}
            disabled={reference.busy}
            placeholder="Se usará como base para generar las nuevas poses desde la foto de referencia."
          />
        </div>
      ) : null}
    </div>
  </div>
);
