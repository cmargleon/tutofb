import { useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../../feedback/FeedbackProvider';
import { DEFAULT_POSE_SELECTION_IDS, MODEL_POSE_GROUPS, MODEL_POSE_RECIPES } from '../constants';
import {
  buildGeneratedPosePhotoState,
  buildPendingPosePhotos,
  buildReferencePosePhotoState,
  getAcceptedPoseCount,
} from '../aiWizard';
import { generateModelPoses } from '../firebase';
import { buildPosePromptFromRecipe } from '../prompts';
import { GeneratedPhotoState, PoseRecipe } from '../types';
import type { AiIdentityFormState } from './useAiIdentityForm';

interface UseAiPosesParams {
  selectedClientId: string;
  draftModelId: string;
  selectedCandidate: GeneratedPhotoState | null;
  identityForm: Pick<AiIdentityFormState, 'prompt' | 'provider' | 'aspectRatio' | 'providerImageConfig'>;
}

export interface UseAiPosesReturn {
  posePhotos: GeneratedPhotoState[];
  selectedPoseIds: string[];
  selectedPoseRecipes: PoseRecipe[];
  generatingPoses: boolean;
  regeneratingPoseIndex: number | null;
  acceptedPoseCount: number;
  allPosesSelected: boolean;
  canGeneratePoses: boolean;
  poseGroups: typeof MODEL_POSE_GROUPS;
  poseRecipes: typeof MODEL_POSE_RECIPES;
  handleTogglePose: (poseId: string) => void;
  handleToggleAllPoses: () => void;
  handleGeneratePoseSet: () => Promise<void>;
  handleRegeneratePose: (index: number) => Promise<void>;
  handleRejectPose: (index: number) => void;
  handleAcceptPose: (index: number) => void;
  handleAcceptAllPoses: () => void;
  clearPosePhotos: () => void;
  resetPoses: () => void;
}

export const useAiPoses = ({
  selectedClientId,
  draftModelId,
  selectedCandidate,
  identityForm,
}: UseAiPosesParams): UseAiPosesReturn => {
  const toast = useToast();

  const [posePhotos, setPosePhotos] = useState<GeneratedPhotoState[]>([]);
  const [selectedPoseIds, setSelectedPoseIds] = useState<string[]>(DEFAULT_POSE_SELECTION_IDS);
  const [generatingPoses, setGeneratingPoses] = useState(false);
  const [regeneratingPoseIndex, setRegeneratingPoseIndex] = useState<number | null>(null);

  const selectedPoseRecipes = useMemo(
    () => MODEL_POSE_RECIPES.filter((recipe) => selectedPoseIds.includes(recipe.id)),
    [selectedPoseIds],
  );

  const acceptedPoseCount = useMemo(() => getAcceptedPoseCount(posePhotos), [posePhotos]);

  const allPosesSelected = useMemo(
    () => MODEL_POSE_RECIPES.every((recipe) => selectedPoseIds.includes(recipe.id)),
    [selectedPoseIds],
  );

  const canGeneratePoses =
    selectedPoseRecipes.length > 0 && !generatingPoses && regeneratingPoseIndex === null;

  const clearPosePhotos = useCallback(() => setPosePhotos([]), []);

  const resetPoses = useCallback(() => {
    setPosePhotos([]);
    setSelectedPoseIds(DEFAULT_POSE_SELECTION_IDS);
    setRegeneratingPoseIndex(null);
  }, []);

  const handleTogglePose = useCallback((poseId: string) => {
    setSelectedPoseIds((current) => {
      if (current.includes(poseId)) return current.filter((id) => id !== poseId);
      return [...current, poseId];
    });
    setPosePhotos([]);
  }, []);

  const handleToggleAllPoses = useCallback(() => {
    const allPoseIds = MODEL_POSE_RECIPES.map((recipe) => recipe.id);
    setSelectedPoseIds((current) =>
      MODEL_POSE_RECIPES.every((recipe) => current.includes(recipe.id))
        ? DEFAULT_POSE_SELECTION_IDS
        : allPoseIds,
    );
    setPosePhotos([]);
  }, []);

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
              prompt: buildPosePromptFromRecipe(identityForm.prompt.trim(), pose),
              provider: identityForm.provider,
              aspectRatio: identityForm.aspectRatio,
              imageConfig: identityForm.providerImageConfig,
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
    identityForm.providerImageConfig,
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
          prompt: buildPosePromptFromRecipe(identityForm.prompt.trim(), poseRecipe),
          provider: identityForm.provider,
          aspectRatio: identityForm.aspectRatio,
          imageConfig: identityForm.providerImageConfig,
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
      identityForm.providerImageConfig,
      identityForm.prompt,
      identityForm.provider,
      selectedCandidate,
      selectedClientId,
      selectedPoseRecipes,
      toast,
    ],
  );

  const handleRejectPose = useCallback((index: number) => {
    setPosePhotos((prev) =>
      prev.map((photo, photoIndex) =>
        photoIndex === index ? { ...photo, rejected: true } : photo,
      ),
    );
  }, []);

  const handleAcceptPose = useCallback((index: number) => {
    setPosePhotos((prev) =>
      prev.map((photo, photoIndex) =>
        photoIndex === index ? { ...photo, rejected: false } : photo,
      ),
    );
  }, []);

  const handleAcceptAllPoses = useCallback(() => {
    setPosePhotos((prev) => prev.map((photo) => ({ ...photo, rejected: false })));
  }, []);

  return {
    posePhotos,
    selectedPoseIds,
    selectedPoseRecipes,
    generatingPoses,
    regeneratingPoseIndex,
    acceptedPoseCount,
    allPosesSelected,
    canGeneratePoses,
    poseGroups: MODEL_POSE_GROUPS,
    poseRecipes: MODEL_POSE_RECIPES,
    handleTogglePose,
    handleToggleAllPoses,
    handleGeneratePoseSet,
    handleRegeneratePose,
    handleRejectPose,
    handleAcceptPose,
    handleAcceptAllPoses,
    clearPosePhotos,
    resetPoses,
  };
};
