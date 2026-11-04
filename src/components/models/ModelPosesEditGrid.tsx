import React from 'react';
import { RefreshCw, RotateCw, RotateCcw, Trash2 } from 'lucide-react';
import { Model } from '../../../shared/src/types';
import { isPoseActive } from '../../../shared/src/domain';
import { formatPoseClassificationLabel } from '../../../shared/src/utils/poseAiClassification';
import { ImageThumb } from '../ui';
import { UseModelLibraryResult } from '../../features/models/hooks/useModelLibrary';

interface ModelPosesEditGridProps {
  model: Model;
  library: UseModelLibraryResult;
}

export const ModelPosesEditGrid: React.FC<ModelPosesEditGridProps> = ({ model, library }) => (
  <div>
    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
      Poses ({model.poses.length})
    </h4>
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
      {model.poses.map((pose) => {
        const poseMarked = library.editPoseIdsToRemove.includes(pose.id);
        const isRegenerating = library.regeneratingPoseIds.has(pose.id);
        const isUpdating = library.updatingPoseIds.has(pose.id);
        const active = isPoseActive(pose);
        const regeneration = library.getPoseRegenerationAvailability(model, pose);
        return (
          <div
            key={pose.id}
            className={`relative aspect-[3/4] overflow-hidden rounded-md bg-white group ${
              poseMarked ? 'opacity-40' : ''
            }`}
            >
              <div className={`h-full ${active ? '' : 'opacity-50 grayscale'}`}>
                <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
              </div>
            <div className="absolute inset-0 rounded-md bg-black/0 transition-colors group-hover:bg-black/10" />
            <div className="absolute right-1 top-1 z-10 flex items-center gap-1 opacity-100 transition-opacity duration-150 sm:right-2 sm:top-2 sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                type="button"
                role="switch"
                onClick={() => void library.handleTogglePoseActive(model, pose)}
                disabled={isUpdating || isRegenerating || library.isSavingEdit || poseMarked}
                title={active ? 'Desactivar pose (se guarda al pulsar)' : 'Activar pose (se guarda al pulsar)'}
                aria-label={`Pose activa: ${pose.fileName}`}
                aria-checked={active}
                className={`relative inline-flex h-6 w-9 shrink-0 items-center rounded-full shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:w-10 ${active ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-500 hover:bg-gray-600'}`}
              >
                <span className={`absolute left-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow transition-transform ${active ? 'translate-x-3 sm:translate-x-4' : 'translate-x-0'}`}>
                  {isUpdating && <RefreshCw className="h-3 w-3 animate-spin text-gray-500" />}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void library.handleRegeneratePoseFromReference(model, pose)}
                disabled={!regeneration.canRegenerate || isRegenerating || isUpdating || library.isSavingEdit}
                title={regeneration.reason}
                aria-label="Regenerar pose desde referencia frente completa"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/15 text-white/80 shadow-sm backdrop-blur-sm transition hover:bg-black/55 hover:text-white disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-white/35 sm:h-8 sm:w-8"
              >
                {isRegenerating ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => library.handleTogglePoseRemoval(pose.id)}
                disabled={isUpdating || library.isSavingEdit}
                title={poseMarked ? 'Deshacer borrado' : 'Marcar para borrar'}
                aria-label={poseMarked ? 'Deshacer borrado de pose' : 'Marcar pose para borrar'}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/15 text-white/80 shadow-sm backdrop-blur-sm transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8 ${
                  poseMarked
                    ? 'hover:bg-white/80 hover:text-gray-900'
                    : 'hover:bg-red-600/85'
                }`}
              >
                {poseMarked ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-md bg-gradient-to-t from-black/75 to-transparent px-2 py-2">
              <p className={`mb-1 text-[10px] font-semibold ${active ? 'text-emerald-200' : 'text-amber-200'}`}>
                {active ? 'Activa' : 'Inactiva'}
              </p>
              <p className="truncate text-[11px] text-white">{pose.fileName}</p>
              <p className="mt-1 inline-flex rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white">
                {formatPoseClassificationLabel(pose.aiClassification)}
              </p>
              {pose.aiClassification ? (
                <p className="mt-1 inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70">
                  {pose.aiClassification.faceVisible ? 'Con cara' : 'Sin cara'}
                </p>
              ) : null}
              {poseMarked && (
                <p className="mt-1 text-[11px] font-medium text-amber-200">
                  Se eliminará al guardar
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
