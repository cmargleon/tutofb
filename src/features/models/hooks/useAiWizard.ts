import { useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useConfirm, useToast } from '../../feedback/FeedbackProvider';
import {
  AI_WIZARD_MAX_STEP,
  AI_WIZARD_STEPS,
  DEFAULT_POSE_SELECTION_IDS,
  IDENTITY_CANDIDATE_COUNT,
  MODEL_POSE_GROUPS,
  MODEL_POSE_RECIPES,
} from '../constants';
import {
  buildGeneratedPosePhotoState,
  buildPendingPosePhotos,
  buildReferencePosePhotoState,
  getAcceptedPoseCount,
  isAiWizardStepComplete,
  toCandidatePhotoState,
} from '../aiWizard';
import { createModelFromPaths, generateModelPoses } from '../firebase';
import { buildPosePrompt } from '../prompts';
import { GeneratedPhotoState, PoseRecipe } from '../types';
import { AiIdentityFormState, useAiIdentityForm } from './useAiIdentityForm';
import { canSelectWizardStep } from '../../wizard/navigation';

interface UseAiWizardParams {
  newModelName: string;
  selectedClientId: string;
  setNewModelName: (value: string) => void;
  setSelectedClientId: (value: string) => void;
  onSuccess: () => void;
}

export interface ModelCreateFlowAiState extends AiIdentityFormState {
  wizardSteps: typeof AI_WIZARD_STEPS;
  identityCandidateCount: number;
  poseGroups: typeof MODEL_POSE_GROUPS;
  poseRecipes: typeof MODEL_POSE_RECIPES;
  wizardStep: number;
  selectedCandidateIndex: number | null;
  selectedCandidate: GeneratedPhotoState | null;
  selectedPoseIds: string[];
  selectedPoseRecipes: PoseRecipe[];
  posePhotos: GeneratedPhotoState[];
  candidates: GeneratedPhotoState[];
  generatingCandidates: boolean;
  generatingPoses: boolean;
  regeneratingCandidateIndex: number | null;
  regeneratingPoseIndex: number | null;
  busy: boolean;
  canGenerateCandidates: boolean;
  canGeneratePoses: boolean;
  canSaveModel: boolean;
  canSelectStep: (stepId: number) => boolean;
  handleStepSelect: (stepId: number) => Promise<void>;
  handleGenerateCandidates: () => Promise<void>;
  handleSelectCandidate: (index: number) => void;
  handleContinueToPoseStep: () => void;
  handleTogglePose: (poseId: string) => void;
  handleToggleAllPoses: () => void;
  allPosesSelected: boolean;
  handleGeneratePoseSet: () => Promise<void>;
  handleRegenerateCandidate: (index: number) => Promise<void>;
  handleRegeneratePose: (index: number) => Promise<void>;
  handleRejectPose: (index: number) => void;
  handleAcceptPose: (index: number) => void;
  handleAcceptAllPoses: () => void;
  acceptedPoseCount: number;
  handleCreateFromAI: () => Promise<void>;
}

export interface UseAiWizardResult {
  ai: ModelCreateFlowAiState;
  isCreating: boolean;
}

export const useAiWizard = ({
  newModelName,
  selectedClientId,
  setNewModelName,
  setSelectedClientId,
  onSuccess,
}: UseAiWizardParams): UseAiWizardResult => {
  const toast = useToast();
  const confirm = useConfirm();
  const identityForm = useAiIdentityForm();

  const [wizardStep, setWizardStep] = useState(1);
  const [candidates, setCandidates] = useState<GeneratedPhotoState[]>([]);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number | null>(null);
  const [selectedPoseIds, setSelectedPoseIds] = useState<string[]>(DEFAULT_POSE_SELECTION_IDS);
  const [posePhotos, setPosePhotos] = useState<GeneratedPhotoState[]>([]);
  const [generatingCandidates, setGeneratingCandidates] = useState(false);
  const [generatingPoses, setGeneratingPoses] = useState(false);
  const [regeneratingCandidateIndex, setRegeneratingCandidateIndex] = useState<number | null>(null);
  const [regeneratingPoseIndex, setRegeneratingPoseIndex] = useState<number | null>(null);
  const [draftModelId, setDraftModelId] = useState(() => uuidv4());
  const [isCreating, setIsCreating] = useState(false);

  const selectedCandidate = useMemo(
    () => (selectedCandidateIndex !== null ? candidates[selectedCandidateIndex] ?? null : null),
    [candidates, selectedCandidateIndex],
  );
  const selectedPoseRecipes = useMemo(
    () => MODEL_POSE_RECIPES.filter((recipe) => selectedPoseIds.includes(recipe.id)),
    [selectedPoseIds],
  );
  const busy =
    generatingCandidates ||
    generatingPoses ||
    regeneratingCandidateIndex !== null ||
    regeneratingPoseIndex !== null;
  const acceptedPoseCount = useMemo(
    () => getAcceptedPoseCount(posePhotos),
    [posePhotos],
  );
  const allPosesSelected = useMemo(
    () => MODEL_POSE_RECIPES.every((recipe) => selectedPoseIds.includes(recipe.id)),
    [selectedPoseIds],
  );
  const canGenerateCandidates = Boolean(
    newModelName.trim() && selectedClientId && identityForm.prompt.trim(),
  );
  const canGeneratePoses =
    selectedPoseRecipes.length > 0 && !generatingPoses && regeneratingPoseIndex === null;
  const canSaveModel = Boolean(acceptedPoseCount > 0 && newModelName.trim() && selectedClientId);

  const canSelectStep = useCallback(
    (stepId: number): boolean => {
      return canSelectWizardStep({
        targetStep: stepId,
        currentStep: wizardStep,
        maxStep: AI_WIZARD_MAX_STEP,
        isStepComplete: (candidateStepId) =>
          isAiWizardStepComplete({
            stepId: candidateStepId,
            candidates,
            selectedCandidate,
          }),
      });
    },
    [candidates, selectedCandidate, wizardStep],
  );

  const resetFlow = useCallback(() => {
    setCandidates([]);
    setSelectedCandidateIndex(null);
    setPosePhotos([]);
    setRegeneratingCandidateIndex(null);
    setRegeneratingPoseIndex(null);
    setSelectedPoseIds(DEFAULT_POSE_SELECTION_IDS);
    setDraftModelId(uuidv4());
    setWizardStep(1);
    identityForm.restoreAutoPrompt();
  }, [identityForm.restoreAutoPrompt]);

  const handleStepSelect = useCallback(
    async (stepId: number) => {
      if (stepId === 1 && wizardStep > 1) {
        const accepted = await confirm({
          title: 'Reiniciar flujo de IA',
          description: 'Volver al paso 1 eliminará los candidatos y poses generados.',
          confirmLabel: 'Sí, reiniciar',
          cancelLabel: 'Cancelar',
          tone: 'warning',
        });
        if (!accepted) return;
        resetFlow();
        return;
      }
      if (canSelectStep(stepId)) {
        setWizardStep(stepId);
      }
    },
    [canSelectStep, confirm, resetFlow, wizardStep],
  );

  const handleTogglePose = useCallback((poseId: string) => {
    setSelectedPoseIds((current) => {
      if (current.includes(poseId)) return current.filter((id) => id !== poseId);
      return [...current, poseId];
    });
    setPosePhotos([]);
  }, []);

  const handleGenerateCandidates = useCallback(async () => {
    if (!selectedClientId || !identityForm.prompt.trim()) return;

    if (candidates.length > 0) {
      const accepted = await confirm({
        title: 'Regenerar candidatos',
        description: 'Se generarán nuevos candidatos y perderás la selección actual.',
        confirmLabel: 'Sí, regenerar',
        cancelLabel: 'Cancelar',
        tone: 'warning',
      });
      if (!accepted) return;
    }

    setGeneratingCandidates(true);
    setCandidates([]);
    setSelectedCandidateIndex(null);
    setPosePhotos([]);
    try {
      const response = await generateModelPoses({
        prompt: identityForm.prompt.trim(),
        provider: identityForm.provider,
        aspectRatio: identityForm.aspectRatio,
        count: IDENTITY_CANDIDATE_COUNT,
        tempSessionId: uuidv4(),
        clientId: selectedClientId,
        modelId: draftModelId,
        stage: 'identity',
      });

      setCandidates(response.photos.map(toCandidatePhotoState));

      if (response.errors.length > 0) {
        toast({
          tone: 'warning',
          title: `${response.errors.length} foto(s) no se pudieron generar`,
          description: response.errors[0]?.message ?? 'Error desconocido',
        });
      }

      setWizardStep(2);
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'Error al generar candidatos',
        description: err.message || 'Inténtalo de nuevo.',
      });
    } finally {
      setGeneratingCandidates(false);
    }
  }, [
    candidates.length,
    confirm,
    draftModelId,
    identityForm.aspectRatio,
    identityForm.prompt,
    identityForm.provider,
    selectedClientId,
    toast,
  ]);

  const handleRegenerateCandidate = useCallback(
    async (index: number) => {
      if (!selectedClientId) return;

      setRegeneratingCandidateIndex(index);
      try {
        const response = await generateModelPoses({
          prompt: identityForm.prompt.trim(),
          provider: identityForm.provider,
          aspectRatio: identityForm.aspectRatio,
          count: 1,
          tempSessionId: uuidv4(),
          clientId: selectedClientId,
          modelId: draftModelId,
          stage: 'identity',
        });
        const newPhoto = response.photos[0];
        if (newPhoto) {
          setCandidates((prev) =>
            prev.map((photo, photoIndex) =>
              photoIndex === index
                ? toCandidatePhotoState(newPhoto)
                : photo,
            ),
          );
          if (selectedCandidateIndex === index) {
            setPosePhotos([]);
          }
        }
      } catch (err: any) {
        toast({
          tone: 'error',
          title: 'Error al regenerar el candidato',
          description: err.message || 'Inténtalo de nuevo.',
        });
      } finally {
        setRegeneratingCandidateIndex(null);
      }
    },
    [
      draftModelId,
      identityForm.aspectRatio,
      identityForm.prompt,
      identityForm.provider,
      selectedCandidateIndex,
      selectedClientId,
      toast,
    ],
  );

  const handleGeneratePoseSet = useCallback(async () => {
    if (
      !selectedClientId ||
      !selectedCandidate ||
      !identityForm.prompt.trim() ||
      selectedPoseRecipes.length === 0
    ) {
      return;
    }

    setGeneratingPoses(true);
    setPosePhotos(buildPendingPosePhotos(selectedPoseRecipes));

    try {
      await Promise.allSettled(
        selectedPoseRecipes.map(async (pose, index) => {
          if (pose.usesReferenceImage) {
            setPosePhotos((prev) =>
              prev.map((photo, photoIndex) =>
                photoIndex === index
                  ? buildReferencePosePhotoState(selectedCandidate, pose)
                  : photo,
              ),
            );
            return;
          }

          try {
            const response = await generateModelPoses({
              prompt: buildPosePrompt(identityForm.prompt.trim(), pose.shotType),
              provider: identityForm.provider,
              aspectRatio: identityForm.aspectRatio,
              count: 1,
              tempSessionId: uuidv4(),
              clientId: selectedClientId,
              modelId: draftModelId,
              stage: 'pose',
              referenceStoragePath: selectedCandidate.storagePath,
            });
            const photo = response.photos[0];
            setPosePhotos((prev) =>
              prev.map((prevPhoto, photoIndex) =>
                photoIndex === index
                  ? buildGeneratedPosePhotoState(photo, pose)
                  : prevPhoto,
              ),
            );
          } catch {
            setPosePhotos((prev) =>
              prev.map((photo, photoIndex) =>
                photoIndex === index
                  ? { ...photo, loading: false, error: true, rejected: true }
                  : photo,
              ),
            );
          }
        }),
      );
    } finally {
      setGeneratingPoses(false);
    }
  }, [
    draftModelId,
    identityForm.aspectRatio,
    identityForm.prompt,
    identityForm.provider,
    selectedCandidate,
    selectedClientId,
    selectedPoseRecipes,
  ]);

  const handleRegeneratePose = useCallback(
    async (index: number) => {
      if (!selectedClientId || !selectedCandidate) return;

      const poseRecipe = selectedPoseRecipes[index];
      if (!poseRecipe || poseRecipe.usesReferenceImage) return;

      setRegeneratingPoseIndex(index);
      try {
        const response = await generateModelPoses({
          prompt: buildPosePrompt(identityForm.prompt.trim(), poseRecipe.shotType),
          provider: identityForm.provider,
          aspectRatio: identityForm.aspectRatio,
          count: 1,
          tempSessionId: uuidv4(),
          clientId: selectedClientId,
          modelId: draftModelId,
          stage: 'pose',
          referenceStoragePath: selectedCandidate.storagePath,
        });
        const newPhoto = response.photos[0];
        if (newPhoto) {
          setPosePhotos((prev) =>
            prev.map((photo, photoIndex) =>
              photoIndex === index
                ? buildGeneratedPosePhotoState(newPhoto, poseRecipe)
                : photo,
            ),
          );
        }
      } catch (err: any) {
        toast({
          tone: 'error',
          title: 'Error al regenerar la pose',
          description: err.message || 'Inténtalo de nuevo.',
        });
      } finally {
        setRegeneratingPoseIndex(null);
      }
    },
    [
      draftModelId,
      identityForm.aspectRatio,
      identityForm.prompt,
      identityForm.provider,
      selectedCandidate,
      selectedClientId,
      selectedPoseRecipes,
      toast,
    ],
  );

  const handleCreateFromAI = useCallback(async () => {
    const trimmedName = newModelName.trim();
    if (!trimmedName || !selectedClientId) return;

    const accepted = posePhotos.filter((photo) => !photo.rejected && !photo.loading);
    if (accepted.length === 0) {
      toast({
        tone: 'warning',
        title: 'Sin fotos aceptadas',
        description: 'Acepta al menos una foto antes de guardar.',
      });
      return;
    }

    setIsCreating(true);
    try {
      await createModelFromPaths(selectedClientId, trimmedName, accepted, {
        modelId: draftModelId,
      });
      setNewModelName('');
      setSelectedClientId('');
      resetFlow();
      onSuccess();
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'Error al guardar el modelo',
        description: err.message || 'Inténtalo de nuevo.',
      });
    } finally {
      setIsCreating(false);
    }
  }, [
    draftModelId,
    newModelName,
    onSuccess,
    posePhotos,
    resetFlow,
    selectedClientId,
    setNewModelName,
    setSelectedClientId,
    toast,
  ]);

  const handleSelectCandidate = (index: number) => {
    setSelectedCandidateIndex(index);
    setPosePhotos([]);
  };

  const handleToggleAllPoses = () => {
    const allPoseIds = MODEL_POSE_RECIPES.map((recipe) => recipe.id);
    setSelectedPoseIds(allPosesSelected ? DEFAULT_POSE_SELECTION_IDS : allPoseIds);
    setPosePhotos([]);
  };

  const handleRejectPose = (index: number) => {
    setPosePhotos((prev) =>
      prev.map((photo, photoIndex) =>
        photoIndex === index ? { ...photo, rejected: true } : photo,
      ),
    );
  };

  const handleAcceptPose = (index: number) => {
    setPosePhotos((prev) =>
      prev.map((photo, photoIndex) =>
        photoIndex === index ? { ...photo, rejected: false } : photo,
      ),
    );
  };

  const handleAcceptAllPoses = () => {
    setPosePhotos((prev) => prev.map((photo) => ({ ...photo, rejected: false })));
  };

  return {
    isCreating,
    ai: {
      ...identityForm,
      wizardSteps: AI_WIZARD_STEPS,
      identityCandidateCount: IDENTITY_CANDIDATE_COUNT,
      poseGroups: MODEL_POSE_GROUPS,
      poseRecipes: MODEL_POSE_RECIPES,
      wizardStep,
      selectedCandidateIndex,
      selectedCandidate,
      selectedPoseIds,
      selectedPoseRecipes,
      posePhotos,
      candidates,
      generatingCandidates,
      generatingPoses,
      regeneratingCandidateIndex,
      regeneratingPoseIndex,
      busy,
      canGenerateCandidates,
      canGeneratePoses,
      canSaveModel,
      canSelectStep,
      handleStepSelect,
      handleGenerateCandidates,
      handleSelectCandidate,
      handleContinueToPoseStep: () => setWizardStep(3),
      handleTogglePose,
      handleToggleAllPoses,
      allPosesSelected,
      handleGeneratePoseSet,
      handleRegenerateCandidate,
      handleRegeneratePose,
      handleRejectPose,
      handleAcceptPose,
      handleAcceptAllPoses,
      acceptedPoseCount,
      handleCreateFromAI,
    },
  };
};
