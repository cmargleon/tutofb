import React from 'react';
import { Check, ChevronDown, ChevronUp, Upload, Wand2 } from 'lucide-react';
import { ModelPhotoProvider } from '../../../shared/src/types';
import {
  ModelCreateFlowReferenceState,
  ModelCreateFlowSharedState,
} from '../../features/models/hooks/useModelCreateFlow';
import { mapModelPhotoProviderToProvider } from '../../features/models/providerImageConfig';
import { MODEL_INPUT_BASE } from '../../features/models/utils';
import { Button } from '../ui';
import { ProviderImageConfigSelection } from '../wizard/ProviderImageConfigSelection';
import { CandidatePhotoCard } from './CandidatePhotoCard';
import { GeneratedPoseCard } from './GeneratedPoseCard';
import { LocalFileThumb } from './LocalFileThumb';
import { SelectField } from './SelectField';

interface ModelReferenceFormProps {
  shared: ModelCreateFlowSharedState;
  reference: ModelCreateFlowReferenceState;
}

const TOGGLE_BASE =
  'cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

export const ModelReferenceForm: React.FC<ModelReferenceFormProps> = ({
  shared,
  reference,
}) => (
  <div className="space-y-5">
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        Foto base del modelo
      </label>
      <p className="mb-3 text-xs text-gray-500">
        Sube una foto de frente y de cuerpo entero. La usaremos como referencia para conservar o aproximar la identidad.
      </p>
      <div className="mt-1 flex justify-center rounded-md border-2 border-dashed border-gray-300 px-6 pb-6 pt-5">
        <div className="space-y-1 text-center">
          <Upload className="mx-auto h-12 w-12 text-gray-400" />
          <div className="flex justify-center text-sm text-gray-600">
            <label
              htmlFor="reference-upload"
              className="relative cursor-pointer rounded-md bg-white font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2"
            >
              <span>Subir foto base</span>
              <input
                id="reference-upload"
                name="reference-upload"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => void reference.handleReferenceFileChange(event)}
                disabled={reference.busy}
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">PNG o JPG. Solo una imagen.</p>
        </div>
      </div>

      {reference.referenceFile ? (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Referencia actual
          </p>
          <div className="grid max-w-[11rem] grid-cols-1 gap-2">
            <LocalFileThumb
              file={reference.referenceFile}
              onRemove={() => void reference.handleRemoveReferenceFile()}
            />
          </div>
        </div>
      ) : null}
    </div>

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
            <option key={option.value} value={option.value}>
              {option.label} - {option.hint}
            </option>
          ))}
        </SelectField>
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

    {reference.identityMode === 'similar' ? (
      <>
        <Button
          type="button"
          variant="secondary"
          size="md"
          loading={reference.generatingCandidates}
          disabled={!reference.canGenerateCandidates}
          onClick={() => void reference.handleGenerateCandidates()}
          className="w-full justify-center"
        >
          <Wand2 className="h-4 w-4" />
          {reference.candidates.length > 0 ? 'Regenerar 4 modelos base' : 'Generar 4 modelos base'}
        </Button>

        {reference.candidates.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">
                Elige 1 modelo base para generar las poses
              </p>
              {reference.selectedCandidate ? (
                <span className="text-xs font-medium text-emerald-600">Modelo base seleccionado</span>
              ) : (
                <span className="text-xs text-gray-500">Selecciona uno para continuar</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {reference.candidates.map((candidate, index) => (
                <CandidatePhotoCard
                  key={`${candidate.storagePath}-${index}`}
                  storagePath={candidate.storagePath}
                  index={index}
                  isSelected={reference.selectedCandidateIndex === index}
                  isRegenerating={reference.regeneratingCandidateIndex === index}
                  disabled={reference.busy}
                  onSelect={() => reference.handleSelectCandidate(index)}
                  onRegenerate={() => void reference.handleRegenerateCandidate(index)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {reference.candidates.length > 0 && !reference.selectedCandidate ? (
          <p className="text-sm text-amber-700">
            Primero elige 1 modelo base de las cuatro opciones generadas.
          </p>
        ) : null}
      </>
    ) : (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        En modo <strong>Igual</strong>, la foto de referencia se usa directamente como modelo base. Puedes ir
        directo a elegir las poses.
      </div>
    )}

    {reference.identityMode === 'exact' || reference.selectedCandidate ? (
      <>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">
              Poses a generar
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({reference.selectedPoseIds.length} de {reference.poseRecipes.length} seleccionadas)
              </span>
            </p>
            <button
              type="button"
              disabled={reference.busy}
              onClick={reference.handleToggleAllPoses}
              className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
            >
              {reference.allPosesSelected ? 'Resetear selección' : 'Seleccionar todas'}
            </button>
          </div>

          <div className="space-y-3">
            {reference.poseGroups.map(({ group, options }) => (
              <div key={group}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {group}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {options.map((pose) => {
                    const isSelected = reference.selectedPoseIds.includes(pose.id);
                    return (
                      <button
                        key={pose.id}
                        type="button"
                        onClick={() => reference.handleTogglePose(pose.id)}
                        disabled={reference.busy}
                        title={pose.shotType}
                        className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {isSelected ? <Check className="h-3 w-3 shrink-0" /> : null}
                        {pose.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="md"
          loading={reference.generatingPoses}
          disabled={!reference.canGeneratePoses}
          onClick={() => void reference.handleGeneratePoseSet()}
          className="w-full justify-center"
        >
          <Wand2 className="h-4 w-4" />
          {reference.posePhotos.length > 0 ? 'Regenerar poses elegidas' : 'Generar poses elegidas'}
        </Button>
      </>
    ) : null}

    {reference.posePhotos.length > 0 ? (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">
            {reference.acceptedPoseCount} de {reference.posePhotos.length} poses seleccionadas
          </p>
          <button
            type="button"
            onClick={reference.handleAcceptAllPoses}
            disabled={reference.busy}
            className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
          >
            Seleccionar todas
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {reference.posePhotos.map((photo, index) => {
            const recipe = reference.selectedPoseRecipes[index];
            return (
              <GeneratedPoseCard
                key={`${photo.storagePath || index}-${photo.label ?? index}`}
                storagePath={photo.storagePath}
                label={photo.label ?? `Pose ${index + 1}`}
                hint={recipe?.shotType}
                rejected={photo.rejected}
                isRegenerating={reference.regeneratingPoseIndex === index}
                isLoading={photo.loading}
                selectionDisabled={shared.isCreating}
                regenerateDisabled={reference.busy}
                onReject={() => reference.handleRejectPose(index)}
                onAccept={() => reference.handleAcceptPose(index)}
                onRegenerate={
                  recipe?.usesReferenceImage
                    ? undefined
                    : () => void reference.handleRegeneratePose(index)
                }
              />
            );
          })}
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          loading={shared.isCreating}
          disabled={!reference.canSaveModel}
          onClick={() => void reference.handleCreateFromReference()}
          className="w-full justify-center"
        >
          <Check className="h-4 w-4" />
          Guardar modelo con estas poses
        </Button>

        {shared.createSuccess ? (
          <p className="flex items-center justify-center gap-1.5 text-sm text-emerald-600">
            <Check className="h-4 w-4" /> Modelo creado con éxito
          </p>
        ) : null}
      </div>
    ) : null}
  </div>
);
