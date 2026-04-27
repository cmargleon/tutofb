import React from 'react';
import { ChevronDown, ChevronUp, Wand2 } from 'lucide-react';
import { ModelPhotoProvider } from '../../../../shared/src/types';
import { ModelCreateFlowAiState } from '../../../features/models/hooks/useModelCreateFlow';
import { mapModelPhotoProviderToProvider } from '../../../features/models/providerImageConfig';
import { MODEL_INPUT_BASE } from '../../../features/models/utils';
import { Button } from '../../ui';
import { SelectField } from '../SelectField';
import { ProviderImageConfigSelection } from '../../wizard/ProviderImageConfigSelection';

interface AiIdentityStepProps {
  ai: ModelCreateFlowAiState;
}

export const AiIdentityStep: React.FC<AiIdentityStepProps> = ({ ai }) => (
  <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Sexo</label>
        <SelectField value={ai.sex} onChange={(event) => ai.setSex(event.target.value)} disabled={ai.busy}>
          {ai.sexOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Edad</label>
        <SelectField value={ai.age} onChange={(event) => ai.setAge(event.target.value)} disabled={ai.busy}>
          {ai.ageOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Tono de piel</label>
        <SelectField value={ai.skin} onChange={(event) => ai.setSkin(event.target.value)} disabled={ai.busy}>
          {ai.skinOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Color de pelo</label>
        <SelectField
          value={ai.hairColor}
          onChange={(event) => ai.setHairColor(event.target.value)}
          disabled={ai.busy}
        >
          {ai.hairColorOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Largo de pelo</label>
        <SelectField
          value={ai.hairLength}
          onChange={(event) => ai.setHairLength(event.target.value)}
          disabled={ai.busy}
        >
          {ai.hairLengthOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Complexión</label>
        <SelectField value={ai.build} onChange={(event) => ai.setBuild(event.target.value)} disabled={ai.busy}>
          {ai.buildOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Fondo</label>
        <SelectField
          value={ai.background}
          onChange={(event) => ai.setBackground(event.target.value)}
          disabled={ai.busy}
        >
          {ai.backgroundOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="col-span-3">
        <label className="mb-1 flex items-center justify-between text-xs font-medium text-gray-600">
          <span>Bokeh (desenfoque de fondo)</span>
          <span className="font-semibold text-gray-800">{ai.bokeh}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={ai.bokeh}
          onChange={(event) => ai.handleBokehChange(Number(event.target.value))}
          disabled={ai.busy}
          className="w-full accent-indigo-600 disabled:opacity-50"
        />
        <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
          <span>Sin bokeh</span>
          <span>Sutil</span>
          <span>Moderado</span>
          <span>Fuerte</span>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Top</label>
        <SelectField value={ai.top} onChange={(event) => ai.setTop(event.target.value)} disabled={ai.busy}>
          {ai.topOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Parte baja</label>
        <SelectField value={ai.bottom} onChange={(event) => ai.setBottom(event.target.value)} disabled={ai.busy}>
          {ai.bottomOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Calzado</label>
        <SelectField
          value={ai.footwear}
          onChange={(event) => ai.setFootwear(event.target.value)}
          disabled={ai.busy}
        >
          {ai.footwearOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Proveedor IA</label>
        <SelectField
          value={ai.provider}
          onChange={(event) => ai.setProvider(event.target.value as ModelPhotoProvider)}
          disabled={ai.busy}
        >
          {ai.providerOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label} - {option.hint}{option.disabled ? ' · Deshabilitado' : ''}
            </option>
          ))}
        </SelectField>
        {ai.selectedProviderDisabled ? (
          <p className="mt-2 text-xs text-amber-700">
            Este modelo IA está deshabilitado en Configuración. Sigue visible como referencia, pero no se puede usar para generar.
          </p>
        ) : null}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Relación resultante</label>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {ai.aspectOptions.find((option) => option.value === ai.aspectRatio)?.label || ai.aspectRatio}
        </div>
      </div>
    </div>

    <div className={ai.busy ? 'pointer-events-none opacity-60' : undefined}>
      <ProviderImageConfigSelection
        provider={mapModelPhotoProviderToProvider(ai.provider)}
        value={ai.providerImageConfig}
        onChange={ai.setProviderImageConfig}
      />
    </div>

    <div>
      <button
        type="button"
        onClick={() => ai.setPromptExpanded((value) => !value)}
        className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
      >
        <span>
          Opciones avanzadas - Prompt de identidad
          {ai.promptEdited ? <span className="ml-2 text-indigo-600">(editado)</span> : null}
        </span>
        {ai.promptExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {ai.promptExpanded ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-end">
            {ai.promptEdited ? (
              <button
                type="button"
                onClick={ai.restoreAutoPrompt}
                className="text-xs text-indigo-600 hover:underline"
              >
                Restaurar automático
              </button>
            ) : null}
          </div>
          <textarea
            value={ai.prompt}
            onChange={(event) => ai.updatePrompt(event.target.value)}
            rows={3}
            className={`${MODEL_INPUT_BASE} resize-none`}
            disabled={ai.busy}
            placeholder="Se usará para crear candidatos de identidad del modelo."
          />
        </div>
      ) : null}
    </div>

    <Button
      type="button"
      variant="primary"
      size="md"
      loading={ai.generatingCandidates}
      disabled={!ai.canGenerateCandidates}
      onClick={() => void ai.handleGenerateCandidates()}
      className="w-full justify-center"
    >
      <Wand2 className="h-4 w-4" />
      {ai.generatingCandidates
        ? `Generando ${ai.identityCandidateCount} candidato(s)...`
        : `Generar ${ai.identityCandidateCount} candidatos`}
    </Button>
  </div>
);
