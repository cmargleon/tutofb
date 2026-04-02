import React from 'react';
import { Model } from '../../../shared/src/types';
import { formatPoseAutoCategoryLabel } from '../../../shared/src/utils/poseAiClassification';
import { ImageThumb } from '../ui';

export const ModelPosesViewGrid: React.FC<{ model: Model }> = ({ model }) => (
  <div className="mt-4 border-t border-gray-100 pt-4">
    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
      Poses ({model.poses.length})
    </h4>
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
      {model.poses.map((pose) => (
        <div
          key={pose.id}
          className="relative aspect-[3/4] overflow-hidden rounded-md bg-white group"
        >
          <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
          <div className="absolute inset-x-0 bottom-0 rounded-b-md bg-gradient-to-t from-black/80 to-transparent px-2 py-2">
            <p className="truncate text-[11px] text-white">{pose.fileName}</p>
            <p className="mt-1 inline-flex rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white">
              {formatPoseAutoCategoryLabel(pose.aiClassification?.autoCategory)}
            </p>
            {pose.aiClassification ? (
              <p className="mt-1 inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70">
                {pose.aiClassification.faceVisible ? 'Con cara' : 'Sin cara'}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  </div>
);
