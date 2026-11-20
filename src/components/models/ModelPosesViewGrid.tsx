import { modelPoseZoneAndShot } from '../../../shared/src/modelPoseCatalog';
import React from 'react';
import { Model } from '../../../shared/src/types';
import { isPoseActive } from '../../../shared/src/domain';
import { ImageThumb } from '../ui';

export const ModelPosesViewGrid: React.FC<{ model: Model; poses?: Model['poses']; rejectionReasons?: Record<string, string> }> = ({ model, poses = model.poses, rejectionReasons }) => (
  <div className="mt-4 border-t border-gray-100 pt-4">
    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
      Poses ({poses.length})
    </h4>
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
      {poses.map((pose) => (
        <div
          key={pose.id}
          className="relative aspect-[3/4] overflow-hidden rounded-md bg-white group"
        >
          <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} previewOnClick />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-md bg-gradient-to-t from-black/80 to-transparent px-2 py-2">
            {rejectionReasons?.[pose.id] && <p className="mb-1 text-[10px] text-amber-200">Rechazada · {rejectionReasons[pose.id]}</p>}
            {!rejectionReasons?.[pose.id] && !isPoseActive(pose) && <p className="mb-1 text-[10px] font-semibold text-amber-200">Inactiva</p>}
            <p className="truncate text-[11px] text-white">{pose.fileName}</p>
            <p className="mt-1 inline-flex rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white">
              {modelPoseZoneAndShot(pose)}
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
