import React from 'react';
import { Check, Wand2 } from 'lucide-react';
import {
  ModelCreateFlowAiState,
  ModelCreateFlowSharedState,
} from '../../../features/models/hooks/useModelCreateFlow';
import { Button } from '../../ui';
import { GeneratedPoseCard } from '../GeneratedPoseCard';

interface AiPosesStepProps {
  shared: ModelCreateFlowSharedState;
  ai: ModelCreateFlowAiState;
}

export const AiPosesStep: React.FC<AiPosesStepProps> = ({ shared, ai }) => (
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
      loading={ai.generatingPoses}
      disabled={!ai.canGeneratePoses}
      onClick={() => void ai.handleGeneratePoseSet()}
      className="w-full justify-center"
    >
      <Wand2 className="h-4 w-4" />
      {ai.posePhotos.length > 0 ? 'Regenerar poses elegidas' : 'Generar poses elegidas'}
    </Button>

    {ai.posePhotos.length > 0 ? (
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

        {shared.createSuccess ? (
          <p className="flex items-center justify-center gap-1.5 text-sm text-emerald-600">
            <Check className="h-4 w-4" /> Modelo creado con éxito
          </p>
        ) : null}
      </div>
    ) : null}

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
);
