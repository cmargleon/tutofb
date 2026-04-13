import React from 'react';
import { AlertCircle, Check, RefreshCcw, Sparkles } from 'lucide-react';
import { Model } from '../../../shared/src/types';
import { formatPoseAutoCategoryLabel } from '../../../shared/src/utils/poseAiClassification';
import { countCompatibleGarmentsForPose } from '../../../shared/src/utils/garmentViewMatching';
import { getGarmentAvailableViews, getGarmentBodyArea } from '../../features/generate/garments';
import { UploadedGarmentDraft } from '../../features/generate/types';
import { EmptyState, ImageThumb } from '../ui';

interface Props {
  selectedModel: Model | null;
  garments: UploadedGarmentDraft[];
  selectedPoseIds: string[];
  suggestedPoseIds: string[];
  compatiblePoseIds: string[];
  allPosesSelected: boolean | null | undefined;
  isPreparing: boolean;
  suggestionError: string | null;
  missingPoseClassificationCount: number;
  onPoseToggle: (poseId: string) => void;
  onToggleAllPoses: () => void;
  onRetrySuggestions: () => void;
}

export const PoseSelectionStep: React.FC<Props> = ({
  selectedModel,
  garments,
  selectedPoseIds,
  suggestedPoseIds,
  compatiblePoseIds,
  allPosesSelected,
  isPreparing,
  suggestionError,
  missingPoseClassificationCount,
  onPoseToggle,
  onToggleAllPoses,
  onRetrySuggestions,
}) => {
  if (!selectedModel) {
    return (
      <EmptyState
        title="Primero elige un modelo"
        description="Las sugerencias de poses aparecerán aquí después de seleccionar cliente, modelo y prendas."
        icon={<Sparkles className="w-6 h-6" />}
      />
    );
  }

  const compatiblePoseIdSet = new Set(compatiblePoseIds);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Poses sugeridas</h2>
            <p className="text-sm text-slate-500">
              Analizamos cada foto original por separado y preseleccionamos las poses compatibles. Después puedes
              ajustar la selección manualmente.
            </p>
          </div>

          {suggestionError ? (
            <button
              type="button"
              onClick={onRetrySuggestions}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Reintentar sugerencias
            </button>
          ) : null}
        </div>

        <div className="mt-5 space-y-3">
          {isPreparing ? (
            <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Subiendo fotos y clasificando vistas para sugerir poses automáticamente.</span>
            </div>
          ) : null}

          {suggestionError ? (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{suggestionError}. Puedes seguir con selección manual.</span>
            </div>
          ) : null}

          {!isPreparing && !suggestionError ? (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {suggestedPoseIds.length > 0
                  ? `Se sugirieron ${suggestedPoseIds.length} pose${suggestedPoseIds.length === 1 ? '' : 's'} compatibles con al menos una prenda del lote.`
                  : 'No hubo una sugerencia automática útil para el lote; puedes elegir las poses manualmente.'}
              </span>
            </div>
          ) : null}

          {missingPoseClassificationCount > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {missingPoseClassificationCount} pose{missingPoseClassificationCount === 1 ? '' : 's'} del modelo no
              tienen `aiClassification`, así que quedan fuera del matching estricto hasta que se clasifiquen.
            </div>
          ) : null}
        </div>
      </div>

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
            disabled={compatiblePoseIds.length === 0}
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {allPosesSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {selectedModel.poses.map((pose) => {
            const selected = selectedPoseIds.includes(pose.id);
            const suggested = suggestedPoseIds.includes(pose.id);
            const compatibleGarmentCount = countCompatibleGarmentsForPose(
              pose.aiClassification,
              garments.map((garment) => ({
                availableViews: getGarmentAvailableViews(garment),
                garmentBodyArea: getGarmentBodyArea(garment),
              })),
            );
            const isCompatible = compatiblePoseIdSet.has(pose.id);

            return (
              <button
                type="button"
                key={pose.id}
                onClick={() => onPoseToggle(pose.id)}
                disabled={!isCompatible}
                className={`relative overflow-hidden rounded-3xl border transition ${
                  selected ? 'border-emerald-600 ring-2 ring-emerald-600/20' : 'border-slate-200 hover:border-slate-300'
                } ${
                  isCompatible ? '' : 'cursor-not-allowed opacity-55'
                }`}
              >
                <div className="aspect-[3/4] bg-slate-100">
                  <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                </div>
                <div className="space-y-1 px-3 py-3 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="line-clamp-1 text-sm font-medium text-slate-900">{pose.fileName}</p>
                      <p className="text-xs text-slate-500">Pose {pose.id.slice(0, 6)}</p>
                    </div>
                    {selected ? (
                      <span className="rounded-full bg-emerald-600 p-1 text-white">
                        <Check className="h-4 w-4" />
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {formatPoseAutoCategoryLabel(pose.aiClassification?.autoCategory)}
                    </span>
                    {pose.aiClassification ? (
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                        {pose.aiClassification.faceVisible ? 'Con cara' : 'Sin cara'}
                      </span>
                    ) : null}
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {compatibleGarmentCount} prenda{compatibleGarmentCount === 1 ? '' : 's'}
                    </span>
                    {!isCompatible ? (
                      <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                        Sin match
                      </span>
                    ) : null}
                    {suggested ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        Sugerida
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
