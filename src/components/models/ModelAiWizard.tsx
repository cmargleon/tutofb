import React from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Wand2,
} from 'lucide-react';
import { AspectRatio, ModelPhotoProvider } from '../../../shared/src/types';
import { WizardStepper } from '../WizardStepper';
import { Button } from '../ui';
import {
  ModelCreateFlowAiState,
  ModelCreateFlowSharedState,
} from '../../features/models/hooks/useModelCreateFlow';
import { MODEL_INPUT_BASE } from '../../features/models/utils';
import { CandidatePhotoCard } from './CandidatePhotoCard';
import { GeneratedPoseCard } from './GeneratedPoseCard';
import { SelectField } from './SelectField';

interface ModelAiWizardProps {
  shared: ModelCreateFlowSharedState;
  ai: ModelCreateFlowAiState;
}

export const ModelAiWizard: React.FC<ModelAiWizardProps> = ({ shared, ai }) => (
  <div className="space-y-6">
    <WizardStepper
      steps={ai.wizardSteps}
      currentStep={ai.wizardStep}
      onStepSelect={(stepId) => void ai.handleStepSelect(stepId)}
      canSelectStep={ai.canSelectStep}
    />

    {ai.wizardStep === 1 && (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Sexo</label>
            <SelectField
              value={ai.sex}
              onChange={(event) => ai.setSex(event.target.value)}
              disabled={ai.busy}
            >
              {ai.sexOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Edad</label>
            <SelectField
              value={ai.age}
              onChange={(event) => ai.setAge(event.target.value)}
              disabled={ai.busy}
            >
              {ai.ageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Tono de piel</label>
            <SelectField
              value={ai.skin}
              onChange={(event) => ai.setSkin(event.target.value)}
              disabled={ai.busy}
            >
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
            <SelectField
              value={ai.build}
              onChange={(event) => ai.setBuild(event.target.value)}
              disabled={ai.busy}
            >
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
            <SelectField
              value={ai.top}
              onChange={(event) => ai.setTop(event.target.value)}
              disabled={ai.busy}
            >
              {ai.topOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Parte baja</label>
            <SelectField
              value={ai.bottom}
              onChange={(event) => ai.setBottom(event.target.value)}
              disabled={ai.busy}
            >
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
                <option key={option.value} value={option.value}>
                  {option.label} - {option.hint}
                </option>
              ))}
            </SelectField>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Relación de aspecto
            </label>
            <SelectField
              value={ai.aspectRatio}
              onChange={(event) => ai.setAspectRatio(event.target.value as AspectRatio)}
              disabled={ai.busy}
            >
              {ai.aspectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => ai.setPromptExpanded((value) => !value)}
            className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
          >
            <span>
              Opciones avanzadas - Prompt de identidad
              {ai.promptEdited && <span className="ml-2 text-indigo-600">(editado)</span>}
            </span>
            {ai.promptExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {ai.promptExpanded && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-end">
                {ai.promptEdited && (
                  <button
                    type="button"
                    onClick={ai.restoreAutoPrompt}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Restaurar automático
                  </button>
                )}
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
          )}
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
    )}

    {ai.wizardStep === 2 && (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Elige 1 candidato como modelo base</p>
          {ai.selectedCandidate && (
            <span className="text-xs font-medium text-emerald-600">
              Modelo base seleccionado
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {ai.candidates.map((photo, index) => (
            <CandidatePhotoCard
              key={`${photo.storagePath}-${index}`}
              storagePath={photo.storagePath}
              index={index}
              isSelected={ai.selectedCandidateIndex === index}
              isRegenerating={ai.regeneratingCandidateIndex === index}
              disabled={ai.busy}
              onSelect={() => ai.handleSelectCandidate(index)}
              onRegenerate={() => void ai.handleRegenerateCandidate(index)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={ai.busy}
            onClick={() => void ai.handleStepSelect(1)}
          >
            Reiniciar
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={!ai.selectedCandidate || ai.busy}
            onClick={ai.handleContinueToPoseStep}
          >
            Continuar
          </Button>
        </div>
      </div>
    )}

    {ai.wizardStep === 3 && ai.selectedCandidate && (
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">
              Poses a generar
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({ai.selectedPoseIds.length} de {ai.poseRecipes.length} seleccionadas)
              </span>
            </p>
            <button
              type="button"
              disabled={ai.busy}
              onClick={ai.handleToggleAllPoses}
              className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
            >
              {ai.allPosesSelected ? 'Resetear selección' : 'Seleccionar todas'}
            </button>
          </div>

          <div className="space-y-3">
            {ai.poseGroups.map(({ group, options }) => (
              <div key={group}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {group}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {options.map((pose) => {
                    const isSelected = ai.selectedPoseIds.includes(pose.id);
                    return (
                      <button
                        key={pose.id}
                        type="button"
                        onClick={() => ai.handleTogglePose(pose.id)}
                        disabled={ai.busy}
                        title={pose.shotType}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3 shrink-0" />}
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
          loading={ai.generatingPoses}
          disabled={!ai.canGeneratePoses}
          onClick={() => void ai.handleGeneratePoseSet()}
          className="w-full justify-center"
        >
          <Wand2 className="h-4 w-4" />
          {ai.posePhotos.length > 0 ? 'Regenerar poses elegidas' : 'Generar poses elegidas'}
        </Button>

        {ai.posePhotos.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">
                {ai.acceptedPoseCount} de {ai.posePhotos.length} poses seleccionadas
              </p>
              <button
                type="button"
                onClick={ai.handleAcceptAllPoses}
                disabled={ai.busy}
                className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
              >
                Seleccionar todas
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {ai.posePhotos.map((photo, index) => {
                const recipe = ai.selectedPoseRecipes[index];
                return (
                  <GeneratedPoseCard
                    key={`${photo.storagePath || index}-${photo.label ?? index}`}
                    storagePath={photo.storagePath}
                    label={photo.label ?? `Pose ${index + 1}`}
                    hint={recipe?.shotType}
                    rejected={photo.rejected}
                    isRegenerating={ai.regeneratingPoseIndex === index}
                    isLoading={photo.loading}
                    disabled={ai.busy}
                    onReject={() => ai.handleRejectPose(index)}
                    onAccept={() => ai.handleAcceptPose(index)}
                    onRegenerate={
                      recipe?.usesReferenceImage
                        ? undefined
                        : () => void ai.handleRegeneratePose(index)
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
              disabled={!ai.canSaveModel}
              onClick={() => void ai.handleCreateFromAI()}
              className="w-full justify-center"
            >
              <Check className="h-4 w-4" />
              Guardar modelo con estas poses
            </Button>

            {shared.createSuccess && (
              <p className="flex items-center justify-center gap-1.5 text-sm text-emerald-600">
                <Check className="h-4 w-4" /> Modelo creado con éxito
              </p>
            )}
          </div>
        )}

        <div className="flex pt-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={ai.busy}
            onClick={() => {
              void ai.handleStepSelect(2);
            }}
          >
            Volver
          </Button>
        </div>
      </div>
    )}
  </div>
);
