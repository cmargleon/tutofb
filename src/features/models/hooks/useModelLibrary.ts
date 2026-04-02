import {
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Model, ModelIdentityTraits } from '../../../../shared/src/types';
import { useConfirm, useConfirmByName, useToast } from '../../feedback/FeedbackProvider';
import { createEmptyModelIdentityTraits, normalizeModelIdentityTraits } from '../identityTraits';
import {
  archiveModel,
  permanentlyDeleteModel,
  restoreModel,
  tagModelPosesWithGemini,
  updateModel,
} from '../firebase';

export interface UseModelLibraryResult {
  editingId: string | null;
  editName: string;
  setEditName: Dispatch<SetStateAction<string>>;
  editClientId: string;
  setEditClientId: Dispatch<SetStateAction<string>>;
  editIdentityTraits: ModelIdentityTraits;
  setEditIdentityTraits: Dispatch<SetStateAction<ModelIdentityTraits>>;
  editFilesToAdd: File[];
  editPoseIdsToRemove: string[];
  isSavingEdit: boolean;
  taggingModelId: string | null;
  handleStartEdit: (model: Model) => void;
  handleCancelEdit: () => void;
  handleEditFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleRemovePendingEditFile: (indexToRemove: number) => void;
  handleTogglePoseRemoval: (poseId: string) => void;
  handleSaveEdit: (model: Model) => Promise<void>;
  handleArchive: (model: Model) => Promise<void>;
  handleRestore: (model: Model) => Promise<void>;
  handlePermanentDelete: (model: Model) => Promise<void>;
  handleTagPosesWithGemini: (model: Model) => Promise<void>;
}

interface UseModelLibraryOptions {
  onOptimisticUpdate?: (updater: (prev: Model[]) => Model[]) => void;
  getModelsSnapshot?: () => Model[];
}

export const useModelLibrary = (options: UseModelLibraryOptions = {}): UseModelLibraryResult => {
  const { onOptimisticUpdate, getModelsSnapshot } = options;
  const toast = useToast();
  const confirm = useConfirm();
  const confirmByName = useConfirmByName();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editClientId, setEditClientId] = useState('');
  const [editIdentityTraits, setEditIdentityTraits] = useState<ModelIdentityTraits>(createEmptyModelIdentityTraits);
  const [editFilesToAdd, setEditFilesToAdd] = useState<File[]>([]);
  const [editPoseIdsToRemove, setEditPoseIdsToRemove] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [taggingModelId, setTaggingModelId] = useState<string | null>(null);

  const handleStartEdit = (model: Model) => {
    setEditingId(model.id ?? null);
    setEditName(model.name);
    setEditClientId(model.clientId);
    setEditIdentityTraits(model.identityTraits || createEmptyModelIdentityTraits());
    setEditFilesToAdd([]);
    setEditPoseIdsToRemove([]);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditClientId('');
    setEditIdentityTraits(createEmptyModelIdentityTraits());
    setEditFilesToAdd([]);
    setEditPoseIdsToRemove([]);
    setIsSavingEdit(false);
  };

  const handleEditFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return;

    setEditFilesToAdd((current) => [...current, ...Array.from(event.target.files ?? [])]);
    event.target.value = '';
  };

  const handleRemovePendingEditFile = (indexToRemove: number) => {
    setEditFilesToAdd((current) => current.filter((_, index) => index !== indexToRemove));
  };

  const handleTogglePoseRemoval = (poseId: string) => {
    setEditPoseIdsToRemove((current) =>
      current.includes(poseId)
        ? current.filter((currentPoseId) => currentPoseId !== poseId)
        : [...current, poseId],
    );
  };

  const handleSaveEdit = async (model: Model) => {
    const id = model.id;
    const trimmedName = editName.trim();
    if (!id || !trimmedName || !editClientId) return;

    const remainingPoseCount =
      (model.poses?.filter((pose) => !editPoseIdsToRemove.includes(pose.id)).length || 0)
      + editFilesToAdd.length;

    if (remainingPoseCount === 0) {
      toast({
        tone: 'warning',
        title: 'El modelo no puede quedarse sin poses',
        description:
          'Debes conservar al menos una pose existente o subir una nueva foto antes de guardar.',
      });
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateModel(id, {
        name: trimmedName,
        clientId: editClientId,
        identityTraits: normalizeModelIdentityTraits(editIdentityTraits),
        filesToAdd: editFilesToAdd,
        poseIdsToRemove: editPoseIdsToRemove,
      });
      handleCancelEdit();
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos actualizar el modelo',
        description: err.message || 'Revisa los cambios e inténtalo nuevamente.',
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleArchive = async (model: Model) => {
    const accepted = await confirm({
      title: 'Archivar modelo',
      description: `Vas a archivar "${model.name}" y retirarlo de los flujos de generación.`,
      impact:
        'El modelo deja de estar disponible para nuevos lotes, pero conserva su historial y sus referencias hasta que decidas borrarlo definitivamente.',
      confirmLabel: 'Sí, archivar modelo',
      cancelLabel: 'Mantener activo',
      tone: 'warning',
    });

    if (!accepted || !model.id) return;

    const snapshot = getModelsSnapshot?.();
    onOptimisticUpdate?.((prev) => prev.filter((m) => m.id !== model.id));
    try {
      await archiveModel(model.id);
      toast({
        tone: 'success',
        title: 'Modelo archivado',
        description: `"${model.name}" salió de la biblioteca operativa.`,
      });
    } catch (err: any) {
      if (snapshot) onOptimisticUpdate?.(() => snapshot);
      toast({
        tone: 'error',
        title: 'No pudimos archivar el modelo',
        description:
          err.message || 'Comprueba si aún tiene dependencias activas e inténtalo otra vez.',
      });
    }
  };

  const handleRestore = async (model: Model) => {
    if (!model.id) return;

    const snapshot = getModelsSnapshot?.();
    onOptimisticUpdate?.((prev) => prev.map((m) => m.id === model.id ? { ...m, status: 'active' as const } : m));
    try {
      await restoreModel(model.id);
      toast({
        tone: 'success',
        title: 'Modelo reactivado',
        description: `"${model.name}" volvió a la biblioteca operativa.`,
      });
    } catch (err: any) {
      if (snapshot) onOptimisticUpdate?.(() => snapshot);
      toast({
        tone: 'error',
        title: 'No pudimos reactivar el modelo',
        description: err.message || 'Inténtalo otra vez en un momento.',
      });
    }
  };

  const handlePermanentDelete = async (model: Model) => {
    if (!model.id) return;

    const accepted = await confirm({
      title: 'Borrado permanente',
      description: `Vas a borrar definitivamente "${model.name}".`,
      impact:
        'Esto elimina el modelo, sus fotos y todos sus datos de forma permanente. No se puede deshacer.',
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });

    if (!accepted) return;

    const nameConfirmed = await confirmByName({
      title: 'Confirmar borrado permanente',
      description: `Escribe el nombre exacto del modelo para confirmar que deseas eliminarlo.`,
      impact: 'Esto elimina el modelo, sus fotos y todos sus datos de forma permanente. No se puede deshacer.',
      entityName: model.name,
      entityLabel: 'el nombre del modelo',
      confirmLabel: 'Borrar definitivamente',
      tone: 'danger',
    });
    if (!nameConfirmed) return;

    try {
      await permanentlyDeleteModel(model.id);
      toast({
        tone: 'success',
        title: 'Modelo eliminado definitivamente',
        description: `"${model.name}" se eliminó de forma permanente.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos borrar el modelo definitivamente',
        description: err.message || 'Comprueba dependencias o permisos e inténtalo otra vez.',
      });
    }
  };

  const handleTagPosesWithGemini = async (model: Model) => {
    if (!model.id) return;

    setTaggingModelId(model.id);
    try {
      await tagModelPosesWithGemini({ modelId: model.id, dryRun: false });
      toast({
        tone: 'success',
        title: 'Poses clasificadas con Gemini',
        description: `Las poses de "${model.name}" fueron analizadas y etiquetadas correctamente.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'Error al clasificar poses',
        description: err.message || 'No se pudo completar la clasificación con Gemini.',
      });
    } finally {
      setTaggingModelId(null);
    }
  };

  return {
    editingId,
    editName,
    setEditName,
    editClientId,
    setEditClientId,
    editIdentityTraits,
    setEditIdentityTraits,
    editFilesToAdd,
    editPoseIdsToRemove,
    isSavingEdit,
    taggingModelId,
    handleStartEdit,
    handleCancelEdit,
    handleEditFileChange,
    handleRemovePendingEditFile,
    handleTogglePoseRemoval,
    handleSaveEdit,
    handleArchive,
    handleRestore,
    handlePermanentDelete,
    handleTagPosesWithGemini,
  };
};
