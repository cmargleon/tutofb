import React from 'react';
import { Model } from '../../../shared/src/types';
import { formatPoseAutoCategoryLabel } from '../../../shared/src/utils/poseAiClassification';
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
        return (
          <div
            key={pose.id}
            className={`relative aspect-[3/4] overflow-hidden rounded-md bg-white group ${
              poseMarked ? 'opacity-40' : ''
            }`}
          >
            <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
            <div className="absolute inset-0 rounded-md bg-black/0 transition-colors group-hover:bg-black/10" />
            <div className="absolute inset-x-0 bottom-0 rounded-b-md bg-gradient-to-t from-black/75 to-transparent px-2 py-2">
              <p className="truncate text-[11px] text-white">{pose.fileName}</p>
              <p className="mt-1 inline-flex rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white">
                {formatPoseAutoCategoryLabel(pose.aiClassification?.autoCategory)}
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
            <button
              type="button"
              onClick={() => library.handleTogglePoseRemoval(pose.id)}
              className={`absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium shadow-sm ${
                poseMarked
                  ? 'bg-white text-gray-700'
                  : 'bg-red-600 text-white hover:bg-red-700'
              }`}
            >
              {poseMarked ? 'Deshacer' : 'Quitar'}
            </button>
          </div>
        );
      })}
    </div>
  </div>
);
