import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Edit2,
  Image as ImageIcon,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { Client, Model } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { formatPoseAutoCategoryLabel } from '../../../shared/src/utils/poseAiClassification';
import { UseModelLibraryResult } from '../../features/models/hooks/useModelLibrary';
import { MODEL_INPUT_BASE } from '../../features/models/utils';
import { formatDateTimeLong } from '../../../shared/src/utils/dateUtils';
import { Button, ImageThumb } from '../ui';
import { LocalFileThumb } from './LocalFileThumb';
import { ModelIdentityTraitsFields } from './ModelIdentityTraitsFields';

interface ModelLibraryItemProps {
  model: Model;
  clients: Client[];
  isEditing: boolean;
  isExpanded: boolean;
  isHighlighted: boolean;
  expandedId: string | null;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
  library: UseModelLibraryResult;
}

const ViewPosesGrid: React.FC<{ model: Model }> = ({ model }) => (
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

const EditPosesGrid: React.FC<{
  model: Model;
  library: UseModelLibraryResult;
}> = ({ model, library }) => (
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

export const ModelLibraryItem: React.FC<ModelLibraryItemProps> = ({
  model,
  clients,
  isEditing,
  isExpanded,
  isHighlighted,
  expandedId,
  setExpandedId,
  library,
}) => {
  const hasPoses = model.poses && model.poses.length > 0;

  const handleStartEdit = () => {
    library.handleStartEdit(model);
    setExpandedId(model.id ?? null);
  };

  const handleToggleExpanded = () => {
    if (!model.id) return;
    setExpandedId(expandedId === model.id ? null : model.id);
  };

  return (
    <li
      id={model.id ? `model-${model.id}` : undefined}
      className={`scroll-mt-28 transition-colors hover:bg-gray-50 ${
        isHighlighted ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : ''
      }`}
    >
      <div className="p-4 sm:px-6">
        {isArchivedCatalogEntity(model) && (
          <div className="mb-3 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Archivado
          </div>
        )}

        {isEditing ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={library.editName}
                onChange={(event) => library.setEditName(event.target.value)}
                className={`flex-1 ${MODEL_INPUT_BASE}`}
                placeholder="Nombre del modelo"
              />
              <select
                value={library.editClientId}
                onChange={(event) => library.setEditClientId(event.target.value)}
                className={`flex-1 bg-white ${MODEL_INPUT_BASE}`}
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h4 className="mb-1 text-sm font-medium text-gray-900">Rasgos físicos del modelo</h4>
              <p className="mb-3 text-xs text-gray-500">
                Usa los mismos rasgos del flujo de IA para completar modelos creados sin IA.
              </p>
              <ModelIdentityTraitsFields
                value={library.editIdentityTraits}
                onChange={library.setEditIdentityTraits}
                disabled={library.isSavingEdit}
              />
            </div>

            {hasPoses && <EditPosesGrid model={model} library={library} />}

            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Agregar fotos</h4>
                  <p className="mt-1 text-xs text-gray-500">
                    Las nuevas poses se subirán cuando guardes el modelo.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50">
                  <Upload className="h-3.5 w-3.5" />
                  Subir fotos
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    className="sr-only"
                    onChange={library.handleEditFileChange}
                    disabled={library.isSavingEdit}
                  />
                </label>
              </div>

              {library.editFilesToAdd.length > 0 && (
                <div className="mt-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Nuevas fotos ({library.editFilesToAdd.length})
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {library.editFilesToAdd.map((file, index) => (
                      <LocalFileThumb
                        key={`${file.name}-${file.lastModified}-${index}`}
                        file={file}
                        onRemove={() => library.handleRemovePendingEditFile(index)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {library.editPoseIdsToRemove.length > 0 && (
              <p className="text-xs text-amber-600">
                {library.editPoseIdsToRemove.length} pose
                {library.editPoseIdsToRemove.length === 1 ? '' : 's'} marcada
                {library.editPoseIdsToRemove.length === 1 ? '' : 's'} para eliminar al guardar.
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={library.isSavingEdit}
                onClick={() => void library.handleSaveEdit(model)}
              >
                Guardar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={library.isSavingEdit}
                onClick={library.handleCancelEdit}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-indigo-600">{model.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>Cliente: {model.clientNameSnapshot}</span>
                  <span className="flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" /> {model.poseCount || 0} poses
                  </span>
                  {(model.generatedPhotoCount || 0) > 0 && (
                    <span>
                      IA: {model.generatedPhotoCount} img · $
                      {Number(model.generatedPhotoCostUsd || 0).toFixed(4)}
                    </span>
                  )}
                  <span>Alta: {formatDateTimeLong(model.createdAt)}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {!isArchivedCatalogEntity(model) ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Edit2}
                      onClick={handleStartEdit}
                    >
                      Editar
                    </Button>
                    {hasPoses && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Sparkles}
                        loading={library.taggingModelId === model.id}
                        disabled={library.taggingModelId !== null}
                        onClick={() => void library.handleTagPosesWithGemini(model)}
                        title="Clasificar poses automáticamente con Gemini"
                      >
                        Gemini
                      </Button>
                    )}
                    <Button
                      variant="warning"
                      size="sm"
                      icon={Trash2}
                      onClick={() => void library.handleArchive(model)}
                    >
                      Archivar
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void library.handleRestore(model)}
                      className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                    >
                      Reactivar
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={Trash2}
                      onClick={() => void library.handlePermanentDelete(model)}
                    >
                      Borrar definitivo
                    </Button>
                  </>
                )}

                {hasPoses && (
                  <button
                    type="button"
                    onClick={handleToggleExpanded}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title={isExpanded ? 'Ocultar poses' : 'Ver poses'}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {isExpanded && hasPoses && <ViewPosesGrid model={model} />}
          </>
        )}
      </div>
    </li>
  );
};
