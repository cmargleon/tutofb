import {
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Model, ModelIdentityTraits, ModelPhotoProvider, Pose } from '../../../../shared/src/types';
import { useConfirm, useConfirmByName, useToast } from '../../feedback/FeedbackProvider';
import { createEmptyModelIdentityTraits, normalizeModelIdentityTraits } from '../identityTraits';
import {
  archiveModel,
  downloadModelBundle,
  generateModelPoses,
  importModelBundle,
  permanentlyDeleteModel,
  replaceModelPoseWithGeneratedPhoto,
  restoreModel,
  tagModelPosesWithGemini,
  updateModel,
} from '../firebase';
import { MODEL_POSE_RECIPES_BY_ID } from '../constants';
import { buildManualPoseClassification } from '../poseClassification';
import {
  createDefaultModelProviderImageConfigs,
  mapModelPhotoProviderToProvider,
  resolveModelAspectRatioForImageConfig,
} from '../providerImageConfig';
import { buildReferencePosePromptFromRecipe } from '../prompts';

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
  isImportingBundle: boolean;
  taggingModelId: string | null;
  exportingModelId: string | null;
  regeneratingPoseIds: Set<string>;
  handleStartEdit: (model: Model) => void;
  handleCancelEdit: () => void;
  handleEditFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleRemovePendingEditFile: (indexToRemove: number) => void;
  handleTogglePoseRemoval: (poseId: string) => void;
  handleRegeneratePoseFromReference: (model: Model, pose: Pose) => Promise<void>;
  getPoseRegenerationAvailability: (
    model: Model,
    pose: Pose,
  ) => { canRegenerate: boolean; reason: string };
  handleSaveEdit: (model: Model) => Promise<void>;
  handleArchive: (model: Model) => Promise<void>;
  handleRestore: (model: Model) => Promise<void>;
  handlePermanentDelete: (model: Model) => Promise<void>;
  handleTagPosesWithGemini: (model: Model) => Promise<void>;
  handleExportModelBundle: (model: Model) => Promise<void>;
  handleImportModelBundle: (clientId: string, file: File) => Promise<boolean>;
}

interface UseModelLibraryOptions {
  onOptimisticUpdate?: (updater: (prev: Model[]) => Model[]) => void;
  getModelsSnapshot?: () => Model[];
}

const CATALOG_REGEN_PROVIDER: ModelPhotoProvider = 'openai-dalle';
const CATALOG_REGEN_PROMPT = 'Return a polished catalog-ready fashion image.';
const CATALOG_REGEN_PROVIDER_CONFIG =
  createDefaultModelProviderImageConfigs()[mapModelPhotoProviderToProvider(CATALOG_REGEN_PROVIDER)];
const CATALOG_REGEN_ASPECT_RATIO = resolveModelAspectRatioForImageConfig(CATALOG_REGEN_PROVIDER_CONFIG);

const normalizeLabel = (value: string | null | undefined): string =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const findFrontFullBodyReferencePose = (model: Model): Pose | null =>
  model.poses.find((pose) => {
    const classification = pose.aiClassification;
    return (
      normalizeLabel(classification?.displayLabel) === 'frente completa'
      || (
        classification?.orientationDetail === 'front'
        && classification?.framing === 'full_body'
      )
    );
  }) || null;

const resolvePoseRecipeId = (pose: Pose): string | null => {
  const displayLabel = normalizeLabel(pose.aiClassification?.displayLabel);
  if (displayLabel) {
    for (const [recipeId, recipe] of MODEL_POSE_RECIPES_BY_ID.entries()) {
      if (normalizeLabel(recipe.label) === displayLabel) {
        return recipeId;
      }
    }
  }

  const orientation = pose.aiClassification?.orientationDetail;
  const framing = pose.aiClassification?.framing;
  if (!orientation || !framing) return null;

  switch (framing) {
    case 'full_body':
      switch (orientation) {
        case 'front':
          return 'full-front';
        case 'front_three_quarter':
          return 'full-three-quarter';
        case 'left_profile':
        case 'right_profile':
          return 'full-profile-left';
        case 'back':
          return 'back-full';
        case 'back_three_quarter':
          return 'back-three-quarter';
        default:
          return null;
      }
    case 'medium_body':
      switch (orientation) {
        case 'front':
          return 'half-front';
        case 'front_three_quarter':
          return 'half-three-quarter';
        case 'back':
          return 'half-back';
        default:
          return null;
      }
    case 'lower_body':
      switch (orientation) {
        case 'front':
          return 'lower-front';
        case 'front_three_quarter':
          return 'lower-front-three-quarter';
        case 'back':
          return 'lower-back';
        case 'back_three_quarter':
          return 'lower-back-three-quarter';
        default:
          return null;
      }
    case 'feet_closeup':
      switch (orientation) {
        case 'front':
          return 'footwear-front-closeup';
        case 'front_three_quarter':
          return 'footwear-three-quarter-closeup';
        case 'left_profile':
        case 'right_profile':
          return 'footwear-side-closeup';
        default:
          return null;
      }
    default:
      return null;
  }
};

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
  const [isImportingBundle, setIsImportingBundle] = useState(false);
  const [taggingModelId, setTaggingModelId] = useState<string | null>(null);
  const [exportingModelId, setExportingModelId] = useState<string | null>(null);
  const [regeneratingPoseIds, setRegeneratingPoseIds] = useState<Set<string>>(new Set());

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

  const getPoseRegenerationAvailability = (model: Model, pose: Pose) => {
    const referencePose = findFrontFullBodyReferencePose(model);
    if (!referencePose) {
      return {
        canRegenerate: false,
        reason: 'Necesitas una pose "Frente completa" para usarla como referencia.',
      };
    }

    if (referencePose.id === pose.id) {
      return {
        canRegenerate: false,
        reason: 'La pose de frente completa ya es la referencia base.',
      };
    }

    if (editPoseIdsToRemove.includes(pose.id)) {
      return {
        canRegenerate: false,
        reason: 'Quita la marca de borrado antes de regenerar esta pose.',
      };
    }

    const recipeId = resolvePoseRecipeId(pose);
    if (!recipeId || !MODEL_POSE_RECIPES_BY_ID.get(recipeId)) {
      return {
        canRegenerate: false,
        reason: 'Esta pose no tiene una clasificación compatible para regenerarse.',
      };
    }

    return {
      canRegenerate: true,
      reason: `Regenerar usando "${referencePose.fileName}" como referencia.`,
    };
  };

  const handleRegeneratePoseFromReference = async (model: Model, pose: Pose) => {
    if (!model.id) return;

    const availability = getPoseRegenerationAvailability(model, pose);
    if (!availability.canRegenerate) {
      toast({
        tone: 'warning',
        title: 'No se puede regenerar esta pose',
        description: availability.reason,
      });
      return;
    }

    const recipeId = resolvePoseRecipeId(pose);
    const recipe = recipeId ? MODEL_POSE_RECIPES_BY_ID.get(recipeId) : null;
    const referencePose = findFrontFullBodyReferencePose(model);
    if (!recipe || !referencePose) return;

    setRegeneratingPoseIds((prev) => new Set(prev).add(pose.id));
    try {
      const response = await generateModelPoses({
        prompt: buildReferencePosePromptFromRecipe(CATALOG_REGEN_PROMPT, recipe),
        provider: CATALOG_REGEN_PROVIDER,
        aspectRatio: CATALOG_REGEN_ASPECT_RATIO,
        imageConfig: CATALOG_REGEN_PROVIDER_CONFIG,
        count: 1,
        tempSessionId: uuidv4(),
        clientId: model.clientId,
        modelId: model.id,
        stage: 'pose',
        referenceStoragePath: referencePose.storagePath,
        preserveReferenceDetails: true,
      });

      const photo = response.photos[0];
      if (!photo) {
        throw new Error('La generación no devolvió ninguna imagen.');
      }

      await replaceModelPoseWithGeneratedPhoto(
        model,
        pose.id,
        photo,
        buildManualPoseClassification(recipe),
        response.estimatedCostUsd,
      );

      toast({
        tone: 'success',
        title: 'Pose regenerada',
        description: `Se regeneró "${recipe.label}" usando la referencia de frente completa.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'Error al regenerar la pose',
        description: err.message || 'Inténtalo nuevamente en un momento.',
      });
    } finally {
      setRegeneratingPoseIds((prev) => {
        const next = new Set(prev);
        next.delete(pose.id);
        return next;
      });
    }
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

  const handleExportModelBundle = async (model: Model) => {
    if (!model.id) return;

    setExportingModelId(model.id);
    try {
      await downloadModelBundle(model);
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos exportar el modelo',
        description: err.message || 'Vuelve a intentarlo en un momento.',
      });
    } finally {
      setExportingModelId(null);
    }
  };

  const handleImportModelBundle = async (clientId: string, file: File): Promise<boolean> => {
    const trimmedClientId = clientId.trim();
    if (!trimmedClientId || !file) {
      toast({
        tone: 'warning',
        title: 'Faltan datos para importar',
        description: 'Selecciona un cliente de destino y un ZIP válido antes de continuar.',
      });
      return false;
    }

    setIsImportingBundle(true);
    try {
      const result = await importModelBundle(trimmedClientId, file);
      toast({
        tone: 'success',
        title: 'Modelo importado',
        description: `"${result.modelName}" quedó disponible con ${result.importedPoseCount} pose${result.importedPoseCount === 1 ? '' : 's'}.`,
      });
      return true;
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos importar el modelo',
        description: err.message || 'Revisa el ZIP y vuelve a intentarlo.',
      });
      return false;
    } finally {
      setIsImportingBundle(false);
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
    isImportingBundle,
    taggingModelId,
    exportingModelId,
    regeneratingPoseIds,
    handleStartEdit,
    handleCancelEdit,
    handleEditFileChange,
    handleRemovePendingEditFile,
    handleTogglePoseRemoval,
    handleRegeneratePoseFromReference,
    getPoseRegenerationAvailability,
    handleSaveEdit,
    handleArchive,
    handleRestore,
    handlePermanentDelete,
    handleTagPosesWithGemini,
    handleExportModelBundle,
    handleImportModelBundle,
  };
};
