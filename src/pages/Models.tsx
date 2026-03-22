import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader, LoadingBlock, EmptyState, ImageThumb, Button } from '../components/ui';
import { WizardStepper } from '../components/WizardStepper';
import { subscribeToModels, createModel, updateModel, archiveModel, restoreModel, permanentlyDeleteModel, generateModelPoses, createModelFromPaths } from '../features/models/firebase';
import { subscribeToClients } from '../features/clients/firebase';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';
import { Model, Client, ModelPhotoProvider, AspectRatio } from '../../shared/src/types';
import { isActiveCatalogEntity, isArchivedCatalogEntity } from '../../shared/src/domain';
import { UserSquare2, Plus, Edit2, Trash2, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Image as ImageIcon, Upload, Wand2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import { CreateTab, GeneratedPhotoState } from '../features/models/types';
import {
  IDENTITY_CANDIDATE_COUNT,
  MODEL_POSE_RECIPES,
  MODEL_POSE_GROUPS,
  DEFAULT_POSE_SELECTION_IDS,
  AI_WIZARD_STEPS,
  SEX_OPTIONS,
  AGE_OPTIONS,
  SKIN_OPTIONS,
  HAIR_COLOR_OPTIONS,
  HAIR_LENGTH_OPTIONS,
  BUILD_OPTIONS,
  BACKGROUND_OPTIONS,
  TOP_OPTIONS,
  BOTTOM_OPTIONS,
  FOOTWEAR_OPTIONS,
  ASPECT_OPTIONS,
  PROVIDER_OPTIONS,
} from '../features/models/constants';
import { buildIdentityPrompt, buildPosePrompt } from '../features/models/prompts';
import { SelectField } from '../components/models/SelectField';
import { LocalFileThumb } from '../components/models/LocalFileThumb';
import { CandidatePhotoCard } from '../components/models/CandidatePhotoCard';
import { GeneratedPoseCard } from '../components/models/GeneratedPoseCard';

const INPUT_BASE =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400';

const formatDate = (timestamp: any) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

export const Models: React.FC = () => {
  const location = useLocation();
  const toast = useToast();
  const confirm = useConfirm();
  const [models, setModels] = useState<Model[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create state
  const [createTab, setCreateTab] = useState<CreateTab>('upload');
  const [newModelName, setNewModelName] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  // AI generation state
  const [aiSex, setAiSex] = useState('female');
  const [aiAge, setAiAge] = useState('25-35');
  const [aiSkin, setAiSkin] = useState('medium');
  const [aiHairColor, setAiHairColor] = useState('brunette');
  const [aiHairLength, setAiHairLength] = useState('medium-length');
  const [aiBuild, setAiBuild] = useState('average');
  const [aiBackground, setAiBackground] = useState('pure white seamless backdrop, no shadows');
  const [aiBokeh, setAiBokeh] = useState(0);
  const [aiTop, setAiTop] = useState('plain white t-shirt');
  const [aiBottom, setAiBottom] = useState('plain black pants');
  const [aiFootwear, setAiFootwear] = useState('plain white sneakers');
  const [aiProvider, setAiProvider] = useState<ModelPhotoProvider>('openai-dalle');
  const [aiAspectRatio, setAiAspectRatio] = useState<AspectRatio>('3:4');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPromptEdited, setAiPromptEdited] = useState(false);
  const [aiGeneratingCandidates, setAiGeneratingCandidates] = useState(false);
  const [aiGeneratingPoses, setAiGeneratingPoses] = useState(false);
  const [aiCandidates, setAiCandidates] = useState<GeneratedPhotoState[]>([]);
  const [aiSelectedCandidateIndex, setAiSelectedCandidateIndex] = useState<number | null>(null);
  const [aiSelectedPoseIds, setAiSelectedPoseIds] = useState<string[]>(DEFAULT_POSE_SELECTION_IDS);
  const [aiPosePhotos, setAiPosePhotos] = useState<GeneratedPhotoState[]>([]);
  const [aiRegeneratingCandidateIndex, setAiRegeneratingCandidateIndex] = useState<number | null>(null);
  const [aiRegeneratingPoseIndex, setAiRegeneratingPoseIndex] = useState<number | null>(null);
  const [aiDraftModelId, setAiDraftModelId] = useState(() => uuidv4());
  const [aiWizardStep, setAiWizardStep] = useState(1);
  const [aiPromptExpanded, setAiPromptExpanded] = useState(false);

  // Keep AI prompt in sync with configurator unless user edited it manually
  useEffect(() => {
    if (!aiPromptEdited) {
      setAiPrompt(buildIdentityPrompt({
        sex: aiSex, age: aiAge, skin: aiSkin,
        hairColor: aiHairColor, hairLength: aiHairLength,
        build: aiBuild, background: aiBackground, bokeh: aiBokeh,
        top: aiTop, bottom: aiBottom, footwear: aiFootwear,
      }));
    }
  }, [aiSex, aiAge, aiSkin, aiHairColor, aiHairLength, aiBuild, aiBackground, aiBokeh, aiTop, aiBottom, aiFootwear, aiPromptEdited]);

  const selectedCandidate =
    aiSelectedCandidateIndex !== null ? aiCandidates[aiSelectedCandidateIndex] ?? null : null;
  const selectedPoseRecipes = MODEL_POSE_RECIPES.filter((r) => aiSelectedPoseIds.includes(r.id));
  const aiBusy =
    aiGeneratingCandidates ||
    aiGeneratingPoses ||
    aiRegeneratingCandidateIndex !== null ||
    aiRegeneratingPoseIndex !== null;

  const canSelectAiStep = useCallback((stepId: number): boolean => {
    if (stepId === 1) return true;
    if (stepId === 2) return aiCandidates.length > 0;
    if (stepId === 3) return selectedCandidate !== null;
    return false;
  }, [aiCandidates, selectedCandidate]);

  const resetAIGenerationFlow = useCallback(() => {
    setAiCandidates([]);
    setAiSelectedCandidateIndex(null);
    setAiPosePhotos([]);
    setAiRegeneratingCandidateIndex(null);
    setAiRegeneratingPoseIndex(null);
    setAiSelectedPoseIds(DEFAULT_POSE_SELECTION_IDS);
    setAiPromptEdited(false);
    setAiDraftModelId(uuidv4());
    setAiWizardStep(1);
  }, []);

  const handleAiStepSelect = useCallback(async (stepId: number) => {
    if (stepId === 1 && aiWizardStep > 1) {
      const accepted = await confirm({
        title: 'Reiniciar flujo de IA',
        description: 'Volver al paso 1 eliminará los candidatos y poses generados.',
        confirmLabel: 'Sí, reiniciar',
        cancelLabel: 'Cancelar',
        tone: 'warning',
      });
      if (!accepted) return;
      resetAIGenerationFlow();
      return;
    }
    if (canSelectAiStep(stepId)) {
      setAiWizardStep(stepId);
    }
  }, [aiWizardStep, confirm, resetAIGenerationFlow, canSelectAiStep]);

  const handleTogglePose = useCallback((poseId: string) => {
    setAiSelectedPoseIds((current) => {
      if (current.includes(poseId)) {
        return current.filter((id) => id !== poseId);
      }
      return [...current, poseId];
    });
    setAiPosePhotos([]);
  }, []);

  const handleGenerateCandidates = useCallback(async () => {
    if (!selectedClientId || !aiPrompt.trim()) return;

    if (aiCandidates.length > 0) {
      const accepted = await confirm({
        title: 'Regenerar candidatos',
        description: 'Se generarán nuevos candidatos y perderás la selección actual.',
        confirmLabel: 'Sí, regenerar',
        cancelLabel: 'Cancelar',
        tone: 'warning',
      });
      if (!accepted) return;
    }

    setAiGeneratingCandidates(true);
    setAiCandidates([]);
    setAiSelectedCandidateIndex(null);
    setAiPosePhotos([]);
    try {
      const response = await generateModelPoses({
        prompt: aiPrompt.trim(),
        provider: aiProvider,
        aspectRatio: aiAspectRatio,
        count: IDENTITY_CANDIDATE_COUNT,
        tempSessionId: uuidv4(),
        clientId: selectedClientId,
        modelId: aiDraftModelId,
        stage: 'identity',
      });
      setAiCandidates(
        response.photos.map((p) => ({
          storagePath: p.storagePath,
          contentType: p.contentType,
          rejected: false,
          source: 'candidate',
        })),
      );
      if (response.errors.length > 0) {
        toast({
          tone: 'warning',
          title: `${response.errors.length} foto(s) no se pudieron generar`,
          description: response.errors[0]?.message ?? 'Error desconocido',
        });
      }
      setAiWizardStep(2);
    } catch (err: any) {
      toast({ tone: 'error', title: 'Error al generar candidatos', description: err.message || 'Inténtalo de nuevo.' });
    } finally {
      setAiGeneratingCandidates(false);
    }
  }, [selectedClientId, aiPrompt, aiProvider, aiAspectRatio, aiDraftModelId, aiCandidates, confirm, toast]);

  const handleRegenerateCandidate = useCallback(async (index: number) => {
    if (!selectedClientId) return;
    setAiRegeneratingCandidateIndex(index);
    try {
      const response = await generateModelPoses({
        prompt: aiPrompt.trim(),
        provider: aiProvider,
        aspectRatio: aiAspectRatio,
        count: 1,
        tempSessionId: uuidv4(),
        clientId: selectedClientId,
        modelId: aiDraftModelId,
        stage: 'identity',
      });
      const newPhoto = response.photos[0];
      if (newPhoto) {
        setAiCandidates((prev) =>
          prev.map((p, i) =>
            i === index
              ? { storagePath: newPhoto.storagePath, contentType: newPhoto.contentType, rejected: false, source: 'candidate' }
              : p,
          ),
        );
        if (aiSelectedCandidateIndex === index) {
          setAiPosePhotos([]);
        }
      }
    } catch (err: any) {
      toast({ tone: 'error', title: 'Error al regenerar el candidato', description: err.message || 'Inténtalo de nuevo.' });
    } finally {
      setAiRegeneratingCandidateIndex(null);
    }
  }, [
    selectedClientId,
    aiPrompt,
    aiProvider,
    aiAspectRatio,
    aiDraftModelId,
    aiSelectedCandidateIndex,
    toast,
  ]);

  const handleGeneratePoseSet = useCallback(async () => {
    if (!selectedClientId || !selectedCandidate || !aiPrompt.trim() || selectedPoseRecipes.length === 0) return;

    setAiGeneratingPoses(true);
    // Initialize all poses as loading placeholders for incremental updates
    setAiPosePhotos(
      selectedPoseRecipes.map((pose) => ({
        storagePath: '',
        contentType: '',
        rejected: false,
        label: pose.label,
        source: 'pose' as const,
        loading: true,
        error: false,
      })),
    );

    try {
      await Promise.allSettled(
        selectedPoseRecipes.map(async (pose, index) => {
          if (pose.usesReferenceImage) {
            setAiPosePhotos((prev) =>
              prev.map((p, i) =>
                i === index
                  ? {
                      storagePath: selectedCandidate.storagePath,
                      contentType: selectedCandidate.contentType,
                      rejected: false,
                      label: pose.label,
                      source: 'pose' as const,
                      loading: false,
                      error: false,
                    }
                  : p,
              ),
            );
            return;
          }

          try {
            const response = await generateModelPoses({
              prompt: buildPosePrompt(aiPrompt.trim(), pose.shotType),
              provider: aiProvider,
              aspectRatio: aiAspectRatio,
              count: 1,
              tempSessionId: uuidv4(),
              clientId: selectedClientId,
              modelId: aiDraftModelId,
              stage: 'pose',
              referenceStoragePath: selectedCandidate.storagePath,
            });
            const photo = response.photos[0];
            setAiPosePhotos((prev) =>
              prev.map((p, i) =>
                i === index
                  ? {
                      storagePath: photo?.storagePath ?? '',
                      contentType: photo?.contentType ?? '',
                      rejected: !photo,
                      label: pose.label,
                      source: 'pose' as const,
                      loading: false,
                      error: !photo,
                    }
                  : p,
              ),
            );
          } catch {
            setAiPosePhotos((prev) =>
              prev.map((p, i) =>
                i === index ? { ...p, loading: false, error: true, rejected: true } : p,
              ),
            );
          }
        }),
      );
    } finally {
      setAiGeneratingPoses(false);
    }
  }, [
    selectedClientId,
    selectedCandidate,
    aiPrompt,
    aiProvider,
    aiAspectRatio,
    aiDraftModelId,
    selectedPoseRecipes,
  ]);

  const handleRegeneratePose = useCallback(async (index: number) => {
    if (!selectedClientId || !selectedCandidate) return;

    const poseRecipe = selectedPoseRecipes[index];
    if (!poseRecipe || poseRecipe.usesReferenceImage) return;

    setAiRegeneratingPoseIndex(index);
    try {
      const response = await generateModelPoses({
        prompt: buildPosePrompt(aiPrompt.trim(), poseRecipe.shotType),
        provider: aiProvider,
        aspectRatio: aiAspectRatio,
        count: 1,
        tempSessionId: uuidv4(),
        clientId: selectedClientId,
        modelId: aiDraftModelId,
        stage: 'pose',
        referenceStoragePath: selectedCandidate.storagePath,
      });
      const newPhoto = response.photos[0];
      if (newPhoto) {
        setAiPosePhotos((prev) =>
          prev.map((photo, photoIndex) =>
            photoIndex === index
              ? {
                  storagePath: newPhoto.storagePath,
                  contentType: newPhoto.contentType,
                  rejected: false,
                  label: poseRecipe.label,
                  source: 'pose',
                }
              : photo,
          ),
        );
      }
    } catch (err: any) {
      toast({ tone: 'error', title: 'Error al regenerar la pose', description: err.message || 'Inténtalo de nuevo.' });
    } finally {
      setAiRegeneratingPoseIndex(null);
    }
  }, [
    selectedClientId,
    selectedCandidate,
    aiPrompt,
    aiProvider,
    aiAspectRatio,
    aiDraftModelId,
    selectedPoseRecipes,
    toast,
  ]);

  const handleCreateFromAI = useCallback(async () => {
    const trimmedName = newModelName.trim();
    if (!trimmedName || !selectedClientId) return;
    const accepted = aiPosePhotos.filter((p) => !p.rejected && !p.loading);
    if (accepted.length === 0) {
      toast({ tone: 'warning', title: 'Sin fotos aceptadas', description: 'Acepta al menos una foto antes de guardar.' });
      return;
    }
    setIsCreating(true);
    try {
      await createModelFromPaths(selectedClientId, trimmedName, accepted, { modelId: aiDraftModelId });
      setNewModelName('');
      setSelectedClientId('');
      resetAIGenerationFlow();
      setCreateSuccess(true);
      setTimeout(() => setCreateSuccess(false), 3000);
    } catch (err: any) {
      toast({ tone: 'error', title: 'Error al guardar el modelo', description: err.message || 'Inténtalo de nuevo.' });
    } finally {
      setIsCreating(false);
    }
  }, [
    newModelName,
    selectedClientId,
    aiPosePhotos,
    aiDraftModelId,
    resetAIGenerationFlow,
    toast,
  ]);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editClientId, setEditClientId] = useState('');
  const [editFilesToAdd, setEditFilesToAdd] = useState<File[]>([]);
  const [editPoseIdsToRemove, setEditPoseIdsToRemove] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [modelsPage, setModelsPage] = useState(1);

  useEffect(() => {
    let modelsLoaded = false;
    let clientsLoaded = false;

    const checkLoading = () => {
      if (modelsLoaded && clientsLoaded) setLoading(false);
    };

    const unsubModels = subscribeToModels(
      (data) => {
        setModels(data);
        modelsLoaded = true;
        checkLoading();
      },
      (err) => {
        console.error("Error loading models:", err);
        setError("Error al cargar los modelos.");
        modelsLoaded = true;
        checkLoading();
      },
      { includeArchived: showArchived },
    );

    const unsubClients = subscribeToClients(
      (data) => {
        setClients(data.filter(isActiveCatalogEntity));
        clientsLoaded = true;
        checkLoading();
      },
      (err) => {
        console.error("Error loading clients:", err);
        clientsLoaded = true;
        checkLoading();
      }
    );

    return () => {
      unsubModels();
      unsubClients();
    };
  }, [showArchived]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newModelName.trim();
    if (!trimmedName || !selectedClientId || selectedFiles.length === 0) return;

    setIsCreating(true);
    setError(null);
    setCreateSuccess(false);

    try {
      await createModel(selectedClientId, trimmedName, selectedFiles);
      setNewModelName('');
      setSelectedClientId('');
      setSelectedFiles([]);
      setCreateSuccess(true);
      setTimeout(() => setCreateSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al crear modelo');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemoveCreateFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStartEdit = (model: Model) => {
    setEditingId(model.id!);
    setEditName(model.name);
    setEditClientId(model.clientId);
    setEditFilesToAdd([]);
    setEditPoseIdsToRemove([]);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditClientId('');
    setEditFilesToAdd([]);
    setEditPoseIdsToRemove([]);
    setIsSavingEdit(false);
  };

  const handleEditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    setEditFilesToAdd((current) => [...current, ...Array.from(e.target.files || [])]);
    e.target.value = '';
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
      (model.poses?.filter((pose) => !editPoseIdsToRemove.includes(pose.id)).length || 0) + editFilesToAdd.length;

    if (remainingPoseCount === 0) {
      toast({
        tone: 'warning',
        title: 'El modelo no puede quedarse sin poses',
        description: 'Debes conservar al menos una pose existente o subir una nueva foto antes de guardar.',
      });
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateModel(id, {
        name: trimmedName,
        clientId: editClientId,
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
      impact: 'El modelo deja de estar disponible para nuevos lotes, pero conserva su historial y sus referencias hasta que decidas borrarlo definitivamente.',
      confirmLabel: 'Sí, archivar modelo',
      cancelLabel: 'Mantener activo',
      tone: 'warning',
    });

    if (!accepted || !model.id) {
      return;
    }

    try {
      await archiveModel(model.id);
      toast({
        tone: 'success',
        title: 'Modelo archivado',
        description: `"${model.name}" salió de la biblioteca operativa.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos archivar el modelo',
        description: err.message || 'Comprueba si aún tiene dependencias activas e inténtalo otra vez.',
      });
    }
  };

  const handleRestore = async (model: Model) => {
    if (!model.id) return;

    try {
      await restoreModel(model.id);
      toast({
        tone: 'success',
        title: 'Modelo reactivado',
        description: `"${model.name}" volvió a la biblioteca operativa.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos reactivar el modelo',
        description: err.message || 'Inténtalo otra vez en un momento.',
      });
    }
  };

  const handlePermanentDelete = async (model: Model) => {
    if (!model.id) {
      return;
    }

    const accepted = await confirm({
      title: 'Borrado permanente',
      description: `Vas a borrar definitivamente "${model.name}".`,
      impact: 'Esto elimina el modelo, sus fotos y todos sus datos de forma permanente. No se puede deshacer.',
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });

    if (!accepted) {
      return;
    }

    const typedName = window.prompt(`Escribe el nombre exacto del modelo para confirmar el borrado permanente:\n${model.name}`);
    if (typedName !== model.name) {
      toast({
        tone: 'warning',
        title: 'Borrado cancelado',
        description: 'El nombre no coincidió. No se eliminó nada.',
      });
      return;
    }

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

  const MODELS_PAGE_SIZE = 12;

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((m) => m.name.toLowerCase().includes(query));
  }, [models, modelSearch]);

  const modelsTotalPages = Math.max(1, Math.ceil(filteredModels.length / MODELS_PAGE_SIZE));
  const pagedModels = filteredModels.slice((modelsPage - 1) * MODELS_PAGE_SIZE, modelsPage * MODELS_PAGE_SIZE);
  const highlightedModelId = location.hash.startsWith('#model-') ? location.hash.slice('#model-'.length) : null;

  useEffect(() => {
    if (!highlightedModelId) return;

    const targetIndex = models.findIndex((model) => model.id === highlightedModelId);
    if (targetIndex < 0) return;

    if (modelSearch) {
      setModelSearch('');
    }

    if (modelsPage !== Math.floor(targetIndex / MODELS_PAGE_SIZE) + 1) {
      setModelsPage(Math.floor(targetIndex / MODELS_PAGE_SIZE) + 1);
    }

    setExpandedId(highlightedModelId);

    const scrollTarget = () => {
      const element = document.getElementById(`model-${highlightedModelId}`);
      if (!element) return false;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    };

    if (scrollTarget()) return;

    const timeoutId = window.setTimeout(() => {
      scrollTarget();
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [highlightedModelId, modelSearch, models, modelsPage]);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Modelos"
        description="Gestiona los modelos y sus poses (imágenes base) para la generación de catálogo."
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-8">
        {/* Create Form */}
        <div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-600" />
              Nuevo modelo
            </h2>

            {clients.length === 0 && !loading ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Debes crear al menos un cliente antes de poder registrar un modelo.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Client + Name (shared between tabs) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="client" className="mb-1.5 block text-sm font-medium text-gray-700">Cliente</label>
                    <SelectField
                      id="client"
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      disabled={isCreating || aiBusy}
                    >
                      <option value="">Selecciona un cliente...</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </SelectField>
                  </div>
                  <div>
                    <label htmlFor="model-name" className="mb-1.5 block text-sm font-medium text-gray-700">Nombre del modelo</label>
                    <input
                      id="model-name"
                      type="text"
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      className={INPUT_BASE}
                      placeholder="Ej. Modelo Femenino 1"
                      disabled={isCreating || aiBusy}
                    />
                  </div>
                </div>

                {/* Tab toggle */}
                <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setCreateTab('upload')}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      createTab === 'upload'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Upload className="w-4 h-4" /> Subir fotos
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateTab('generate')}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      createTab === 'generate'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Wand2 className="w-4 h-4" /> Generar con IA
                  </button>
                </div>

                {/* ── Upload tab ─────────────────────────────────────────── */}
                {createTab === 'upload' && (
                  <form onSubmit={handleCreate} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Fotos del modelo (Poses)</label>
                      <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                        <div className="space-y-1 text-center">
                          <Upload className="mx-auto h-12 w-12 text-gray-400" />
                          <div className="flex text-sm text-gray-600 justify-center">
                            <label
                              htmlFor="file-upload"
                              className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500"
                            >
                              <span>Subir imágenes</span>
                              <input
                                id="file-upload"
                                name="file-upload"
                                type="file"
                                multiple
                                accept="image/*"
                                className="sr-only"
                                onChange={handleFileChange}
                                disabled={isCreating}
                              />
                            </label>
                          </div>
                          <p className="text-xs text-gray-500">PNG, JPG hasta 10MB</p>
                        </div>
                      </div>
                      {selectedFiles.length > 0 && (
                        <div className="mt-3">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                            Vista previa ({selectedFiles.length})
                          </p>
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                            {selectedFiles.map((file, index) => (
                              <LocalFileThumb
                                key={`${file.name}-${file.lastModified}-${index}`}
                                file={file}
                                onRemove={() => handleRemoveCreateFile(index)}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      loading={isCreating}
                      disabled={!newModelName.trim() || !selectedClientId || selectedFiles.length === 0}
                      className="w-full justify-center"
                    >
                      Guardar modelo
                    </Button>
                    {createSuccess && (
                      <p className="flex items-center justify-center gap-1.5 text-sm text-emerald-600">
                        <Check className="w-4 h-4" /> Modelo creado con éxito
                      </p>
                    )}
                  </form>
                )}

                {/* ── Generate with AI tab ───────────────────────────────── */}
                {createTab === 'generate' && (
                  <div className="space-y-6">

                    {/* Stepper */}
                    <WizardStepper
                      steps={AI_WIZARD_STEPS}
                      currentStep={aiWizardStep}
                      onStepSelect={(stepId) => void handleAiStepSelect(stepId)}
                      canSelectStep={canSelectAiStep}
                    />

                    {/* ── Step 1: Configure identity ── */}
                    {aiWizardStep === 1 && (
                    <div className="space-y-5">
                    {/* Configurator grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Sexo</label>
                        <SelectField value={aiSex} onChange={(e) => setAiSex(e.target.value)} disabled={aiBusy}>
                          {SEX_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Edad</label>
                        <SelectField value={aiAge} onChange={(e) => setAiAge(e.target.value)} disabled={aiBusy}>
                          {AGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Tono de piel</label>
                        <SelectField value={aiSkin} onChange={(e) => setAiSkin(e.target.value)} disabled={aiBusy}>
                          {SKIN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Color de pelo</label>
                        <SelectField value={aiHairColor} onChange={(e) => setAiHairColor(e.target.value)} disabled={aiBusy}>
                          {HAIR_COLOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Largo de pelo</label>
                        <SelectField value={aiHairLength} onChange={(e) => setAiHairLength(e.target.value)} disabled={aiBusy}>
                          {HAIR_LENGTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Complexión</label>
                        <SelectField value={aiBuild} onChange={(e) => setAiBuild(e.target.value)} disabled={aiBusy}>
                          {BUILD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Fondo</label>
                        <SelectField value={aiBackground} onChange={(e) => setAiBackground(e.target.value)} disabled={aiBusy}>
                          {BACKGROUND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                      <div className="col-span-3">
                        <label className="mb-1 flex items-center justify-between text-xs font-medium text-gray-600">
                          <span>Bokeh (desenfoque de fondo)</span>
                          <span className="font-semibold text-gray-800">{aiBokeh}%</span>
                        </label>
                        <input
                          type="range" min={0} max={100} step={5}
                          value={aiBokeh}
                          onChange={(e) => { setAiBokeh(Number(e.target.value)); setAiPromptEdited(false); }}
                          disabled={aiBusy}
                          className="w-full accent-indigo-600 disabled:opacity-50"
                        />
                        <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
                          <span>Sin bokeh</span>
                          <span>Sutil</span>
                          <span>Moderado</span>
                          <span>Fuerte</span>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Top</label>
                        <SelectField value={aiTop} onChange={(e) => setAiTop(e.target.value)} disabled={aiBusy}>
                          {TOP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Parte baja</label>
                        <SelectField value={aiBottom} onChange={(e) => setAiBottom(e.target.value)} disabled={aiBusy}>
                          {BOTTOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Calzado</label>
                        <SelectField value={aiFootwear} onChange={(e) => setAiFootwear(e.target.value)} disabled={aiBusy}>
                          {FOOTWEAR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                    </div>

                    {/* Provider + aspect */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Proveedor IA</label>
                        <SelectField
                          value={aiProvider}
                          onChange={(e) => setAiProvider(e.target.value as ModelPhotoProvider)}
                          disabled={aiBusy}
                        >
                          {PROVIDER_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label} — {o.hint}</option>
                          ))}
                        </SelectField>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Relación de aspecto</label>
                        <SelectField
                          value={aiAspectRatio}
                          onChange={(e) => setAiAspectRatio(e.target.value as AspectRatio)}
                          disabled={aiBusy}
                        >
                          {ASPECT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectField>
                      </div>
                    </div>

                    {/* Advanced: prompt (collapsible) */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setAiPromptExpanded((v) => !v)}
                        className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                      >
                        <span>
                          Opciones avanzadas — Prompt de identidad
                          {aiPromptEdited && <span className="ml-2 text-indigo-600">(editado)</span>}
                        </span>
                        {aiPromptExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {aiPromptExpanded && (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center justify-end">
                            {aiPromptEdited && (
                              <button
                                type="button"
                                onClick={() => setAiPromptEdited(false)}
                                className="text-xs text-indigo-600 hover:underline"
                              >
                                Restaurar automático
                              </button>
                            )}
                          </div>
                          <textarea
                            value={aiPrompt}
                            onChange={(e) => { setAiPrompt(e.target.value); setAiPromptEdited(true); }}
                            rows={3}
                            className={`${INPUT_BASE} resize-none`}
                            disabled={aiBusy}
                            placeholder="Se usará para crear candidatos de identidad del modelo."
                          />
                        </div>
                      )}
                    </div>

                    {/* Generate candidates button */}
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      loading={aiGeneratingCandidates}
                      disabled={!newModelName.trim() || !selectedClientId || !aiPrompt.trim()}
                      onClick={() => void handleGenerateCandidates()}
                      className="w-full justify-center"
                    >
                      <Wand2 className="w-4 h-4" />
                      {aiGeneratingCandidates
                        ? `Generando ${IDENTITY_CANDIDATE_COUNT} candidato(s)...`
                        : `Generar ${IDENTITY_CANDIDATE_COUNT} candidatos`}
                    </Button>
                    </div>
                    )}

                    {/* ── Step 2: Choose candidate ── */}
                    {aiWizardStep === 2 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-700">Elige 1 candidato como modelo base</p>
                        {selectedCandidate && (
                          <span className="text-xs font-medium text-emerald-600">Modelo base seleccionado</span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {aiCandidates.map((photo, index) => (
                          <CandidatePhotoCard
                            key={`${photo.storagePath}-${index}`}
                            storagePath={photo.storagePath}
                            index={index}
                            isSelected={aiSelectedCandidateIndex === index}
                            isRegenerating={aiRegeneratingCandidateIndex === index}
                            disabled={aiBusy}
                            onSelect={() => {
                              setAiSelectedCandidateIndex(index);
                              setAiPosePhotos([]);
                            }}
                            onRegenerate={() => void handleRegenerateCandidate(index)}
                          />
                        ))}
                      </div>

                      {/* Navigation */}
                      <div className="flex items-center justify-between pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="md"
                          disabled={aiBusy}
                          onClick={() => void handleAiStepSelect(1)}
                        >
                          Reiniciar
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          size="md"
                          disabled={!selectedCandidate || aiBusy}
                          onClick={() => setAiWizardStep(3)}
                        >
                          Continuar
                        </Button>
                      </div>
                    </div>
                    )}

                    {/* ── Step 3: Generate and review poses ── */}
                    {aiWizardStep === 3 && selectedCandidate && (
                    <div className="space-y-5">

                      {/* Individual pose chips */}
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-700">
                            Poses a generar
                            <span className="ml-2 text-xs font-normal text-gray-400">
                              ({aiSelectedPoseIds.length} de {MODEL_POSE_RECIPES.length} seleccionadas)
                            </span>
                          </p>
                          <button
                            type="button"
                            disabled={aiBusy}
                            onClick={() => {
                              const allIds = MODEL_POSE_RECIPES.map((r) => r.id);
                              const allSelected = allIds.every((id) => aiSelectedPoseIds.includes(id));
                              setAiSelectedPoseIds(allSelected ? DEFAULT_POSE_SELECTION_IDS : allIds);
                              setAiPosePhotos([]);
                            }}
                            className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                          >
                            {MODEL_POSE_RECIPES.every((r) => aiSelectedPoseIds.includes(r.id))
                              ? 'Resetear selección'
                              : 'Seleccionar todas'}
                          </button>
                        </div>
                        <div className="space-y-3">
                          {MODEL_POSE_GROUPS.map(({ group, options }) => (
                            <div key={group}>
                              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                                {group}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {options.map((pose) => {
                                  const isSelected = aiSelectedPoseIds.includes(pose.id);
                                  return (
                                    <button
                                      key={pose.id}
                                      type="button"
                                      onClick={() => handleTogglePose(pose.id)}
                                      disabled={aiBusy}
                                      title={pose.shotType}
                                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                        isSelected
                                          ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
                                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                                      }`}
                                    >
                                      {isSelected && <Check className="h-3 w-3 shrink-0" />}
                                      {pose.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Generate poses button */}
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        loading={aiGeneratingPoses}
                        disabled={aiGeneratingPoses || selectedPoseRecipes.length === 0 || aiRegeneratingPoseIndex !== null}
                        onClick={() => void handleGeneratePoseSet()}
                        className="w-full justify-center"
                      >
                        <Wand2 className="w-4 h-4" />
                        {aiPosePhotos.length > 0 ? 'Regenerar poses elegidas' : 'Generar poses elegidas'}
                      </Button>

                      {/* Pose grid — shows incrementally as each pose resolves */}
                      {aiPosePhotos.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-gray-700">
                              {aiPosePhotos.filter((p) => !p.rejected && !p.loading).length} de {aiPosePhotos.length} poses seleccionadas
                            </p>
                            <button
                              type="button"
                              onClick={() => setAiPosePhotos((prev) => prev.map((p) => ({ ...p, rejected: false })))}
                              disabled={aiBusy}
                              className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                            >
                              Seleccionar todas
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {aiPosePhotos.map((photo, index) => {
                              const recipe = selectedPoseRecipes[index];
                              return (
                                <GeneratedPoseCard
                                  key={`${photo.storagePath || index}-${photo.label ?? index}`}
                                  storagePath={photo.storagePath}
                                  label={photo.label ?? `Pose ${index + 1}`}
                                  hint={recipe?.shotType}
                                  rejected={photo.rejected}
                                  isRegenerating={aiRegeneratingPoseIndex === index}
                                  isLoading={photo.loading}
                                  disabled={aiBusy}
                                  onReject={() => setAiPosePhotos((prev) => prev.map((p, i) => i === index ? { ...p, rejected: true } : p))}
                                  onAccept={() => setAiPosePhotos((prev) => prev.map((p, i) => i === index ? { ...p, rejected: false } : p))}
                                  onRegenerate={recipe?.usesReferenceImage ? undefined : () => void handleRegeneratePose(index)}
                                />
                              );
                            })}
                          </div>

                          {/* Save button */}
                          <Button
                            type="button"
                            variant="primary"
                            size="md"
                            loading={isCreating}
                            disabled={
                              aiPosePhotos.filter((p) => !p.rejected && !p.loading).length === 0 ||
                              !newModelName.trim() ||
                              !selectedClientId
                            }
                            onClick={() => void handleCreateFromAI()}
                            className="w-full justify-center"
                          >
                            <Check className="w-4 h-4" />
                            Guardar modelo con estas poses
                          </Button>
                          {createSuccess && (
                            <p className="flex items-center justify-center gap-1.5 text-sm text-emerald-600">
                              <Check className="w-4 h-4" /> Modelo creado con éxito
                            </p>
                          )}
                        </div>
                      )}

                      {/* Navigation */}
                      <div className="flex pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="md"
                          disabled={aiBusy}
                          onClick={() => setAiWizardStep(2)}
                        >
                          Volver
                        </Button>
                      </div>
                    </div>
                    )}

                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* List */}
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                  <UserSquare2 className="w-5 h-5 text-indigo-600" />
                  Biblioteca de modelos
                  <span className="ml-2 bg-indigo-100 text-indigo-700 py-0.5 px-2.5 rounded-full text-xs font-semibold">
                    {filteredModels.length}
                  </span>
                </h2>
                <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Mostrar archivados
                </label>
              </div>
              <div className="mt-3">
                <input
                  type="search"
                  value={modelSearch}
                  onChange={(e) => { setModelSearch(e.target.value); setModelsPage(1); }}
                  placeholder="Buscar modelo por nombre..."
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            {loading ? (
              <LoadingBlock />
            ) : filteredModels.length === 0 ? (
              <EmptyState
                title="No hay modelos"
                description="Registra tu primer modelo usando el formulario de arriba."
                icon={<UserSquare2 className="w-6 h-6" />}
              />
            ) : (
              <ul className="divide-y divide-gray-200">
                {pagedModels.map((model) => {
                  const isEditing = editingId === model.id;
                  const isExpanded = expandedId === model.id;
                  const hasPoses = model.poses && model.poses.length > 0;

                  return (
                    <li
                      key={model.id}
                      id={model.id ? `model-${model.id}` : undefined}
                      className={`scroll-mt-28 transition-colors hover:bg-gray-50 ${
                        highlightedModelId === model.id ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : ''
                      }`}
                    >
                      <div className="p-4 sm:px-6">
                        {isArchivedCatalogEntity(model) && (
                          <div className="mb-3 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                            Archivado
                          </div>
                        )}

                        {/* Edit form — full width when active */}
                        {isEditing ? (
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                placeholder="Nombre del modelo"
                              />
                              <select
                                value={editClientId}
                                onChange={(e) => setEditClientId(e.target.value)}
                                className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                              >
                                {clients.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </div>

                            {/* Poses grid with remove controls */}
                            {hasPoses && (
                              <div>
                                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                  Poses ({model.poses.length})
                                </h4>
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                  {model.poses.map(pose => (
                                    <div
                                      key={pose.id}
                                      className={`aspect-[3/4] relative group rounded-md overflow-hidden bg-white ${editPoseIdsToRemove.includes(pose.id) ? 'opacity-40' : ''}`}
                                    >
                                      <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                                      <div className="absolute inset-0 rounded-md bg-black/0 transition-colors group-hover:bg-black/10" />
                                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 py-2 rounded-b-md">
                                        <p className="truncate text-[11px] text-white">{pose.fileName}</p>
                                        {editPoseIdsToRemove.includes(pose.id) && (
                                          <p className="mt-1 text-[11px] font-medium text-amber-200">Se eliminará al guardar</p>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleTogglePoseRemoval(pose.id)}
                                        className={`absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium shadow-sm ${
                                          editPoseIdsToRemove.includes(pose.id)
                                            ? 'bg-white text-gray-700'
                                            : 'bg-red-600 text-white hover:bg-red-700'
                                        }`}
                                      >
                                        {editPoseIdsToRemove.includes(pose.id) ? 'Deshacer' : 'Quitar'}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <h4 className="text-sm font-medium text-gray-900">Agregar fotos</h4>
                                  <p className="mt-1 text-xs text-gray-500">Las nuevas poses se subirán cuando guardes el modelo.</p>
                                </div>
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50">
                                  <Upload className="w-3.5 h-3.5" />
                                  Subir fotos
                                  <input type="file" multiple accept="image/*" className="sr-only" onChange={handleEditFileChange} disabled={isSavingEdit} />
                                </label>
                              </div>
                              {editFilesToAdd.length > 0 && (
                                <div className="mt-4">
                                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Nuevas fotos ({editFilesToAdd.length})
                                  </p>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {editFilesToAdd.map((file, index) => (
                                      <LocalFileThumb
                                        key={`${file.name}-${file.lastModified}-${index}`}
                                        file={file}
                                        onRemove={() => handleRemovePendingEditFile(index)}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {editPoseIdsToRemove.length > 0 && (
                              <p className="text-xs text-amber-600">
                                {editPoseIdsToRemove.length} pose{editPoseIdsToRemove.length === 1 ? '' : 's'} marcada
                                {editPoseIdsToRemove.length === 1 ? '' : 's'} para eliminar al guardar.
                              </p>
                            )}

                            <div className="flex items-center gap-2">
                              <Button variant="primary" size="sm" loading={isSavingEdit} onClick={() => void handleSaveEdit(model)}>
                                Guardar
                              </Button>
                              <Button variant="ghost" size="sm" disabled={isSavingEdit} onClick={handleCancelEdit}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Main row: info left, actions + poses toggle right */}
                            <div className="flex items-center justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-indigo-600 truncate">{model.name}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                  <span>Cliente: {model.clientNameSnapshot}</span>
                                  <span className="flex items-center gap-1">
                                    <ImageIcon className="w-3 h-3" /> {model.poseCount || 0} poses
                                  </span>
                                  {(model.generatedPhotoCount || 0) > 0 && (
                                    <span>
                                      IA: {model.generatedPhotoCount} img · ${Number(model.generatedPhotoCostUsd || 0).toFixed(4)}
                                    </span>
                                  )}
                                  <span>Alta: {formatDate(model.createdAt)}</span>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-2">
                                {!isArchivedCatalogEntity(model) ? (
                                  <>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      icon={Edit2}
                                      onClick={() => { handleStartEdit(model); setExpandedId(model.id!); }}
                                    >
                                      Editar
                                    </Button>
                                    <Button variant="warning" size="sm" icon={Trash2} onClick={() => void handleArchive(model)}>
                                      Archivar
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => void handleRestore(model)}
                                      className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                    >
                                      Reactivar
                                    </Button>
                                    <Button variant="danger" size="sm" icon={Trash2} onClick={() => void handlePermanentDelete(model)}>
                                      Borrar definitivo
                                    </Button>
                                  </>
                                )}

                                {hasPoses && (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedId(isExpanded ? null : model.id!)}
                                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                    title={isExpanded ? 'Ocultar poses' : 'Ver poses'}
                                  >
                                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Expanded: poses grid (view-only) */}
                            {isExpanded && hasPoses && (
                              <div className="mt-4 border-t border-gray-100 pt-4">
                                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                  Poses ({model.poses.length})
                                </h4>
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                  {model.poses.map(pose => (
                                    <div key={pose.id} className="aspect-[3/4] relative group rounded-md overflow-hidden bg-white">
                                      <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {modelsTotalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                <button
                  onClick={() => setModelsPage((p) => Math.max(1, p - 1))}
                  disabled={modelsPage === 1}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <span className="text-sm text-slate-500">
                  Página {modelsPage} de {modelsTotalPages}
                </span>
                <button
                  onClick={() => setModelsPage((p) => Math.min(modelsTotalPages, p + 1))}
                  disabled={modelsPage === modelsTotalPages}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
