import React from 'react';
import { RefreshCw, RotateCw, RotateCcw, Trash2 } from 'lucide-react';
import { Model } from '../../../shared/src/types';
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
        const regeneration = library.getPoseRegenerationAvailability(model, pose);
        return (
          <div
            key={pose.id}
            className={`relative aspect-[3/4] overflow-hidden rounded-md bg-white group ${
              poseMarked ? 'opacity-40' : ''
            }`}
            >
              <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
            <div className="absolute inset-0 rounded-md bg-black/0 transition-colors group-hover:bg-black/10" />
            <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => void library.handleRegeneratePoseFromReference(model, pose)}
                disabled={!regeneration.canRegenerate || isRegenerating || library.isSavingEdit}
                title={regeneration.reason}
                aria-label="Regenerar pose desde referencia frente completa"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/15 text-white/80 shadow-sm backdrop-blur-sm transition hover:bg-black/55 hover:text-white disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-white/35"
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
                title={poseMarked ? 'Deshacer borrado' : 'Marcar para borrar'}
                aria-label={poseMarked ? 'Deshacer borrado de pose' : 'Marcar pose para borrar'}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/15 text-white/80 shadow-sm backdrop-blur-sm transition hover:text-white ${
                  poseMarked
                    ? 'hover:bg-white/80 hover:text-gray-900'
                    : 'hover:bg-red-600/85'
                }`}
              >
                {poseMarked ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
            <div className="absolute inset-x-0 bottom-0 rounded-b-md bg-gradient-to-t from-black/75 to-transparent px-2 py-2">
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
