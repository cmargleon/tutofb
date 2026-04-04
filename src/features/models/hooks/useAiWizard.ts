import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useConfirm, useToast } from '../../feedback/FeedbackProvider';
import { AI_WIZARD_MAX_STEP, AI_WIZARD_STEPS, IDENTITY_CANDIDATE_COUNT } from '../constants';
import { isAiWizardStepComplete } from '../aiWizard';
import { createModelFromPaths } from '../firebase';
import { buildModelIdentityTraitsFromAiForm } from '../identityTraits';
import { buildManualPoseClassification } from '../poseClassification';
import { MODEL_POSE_RECIPES_BY_ID } from '../constants';
import { AiIdentityFormState, useAiIdentityForm } from './useAiIdentityForm';
import { useAiCandidates, UseAiCandidatesReturn } from './useAiCandidates';
import { useAiPoses, UseAiPosesReturn } from './useAiPoses';
import { canSelectWizardStep } from '../../wizard/navigation';

interface UseAiWizardParams {
  newModelName: string;
  selectedClientId: string;
  setNewModelName: (value: string) => void;
  setSelectedClientId: (value: string) => void;
  onSuccess: () => void;
}

export interface ModelCreateFlowAiState
  extends AiIdentityFormState,
    Omit<UseAiCandidatesReturn, 'canGenerateCandidates' | 'resetCandidates'>,
    Omit<UseAiPosesReturn, 'clearPosePhotos' | 'resetPoses'> {
  wizardSteps: typeof AI_WIZARD_STEPS;
  identityCandidateCount: typeof IDENTITY_CANDIDATE_COUNT;
  wizardStep: number;
  busy: boolean;
  canGenerateCandidates: boolean;
  canSaveModel: boolean;
  canSelectStep: (stepId: number) => boolean;
  handleStepSelect: (stepId: number) => Promise<void>;
  handleContinueToPoseStep: () => void;
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
  const [draftModelId] = useState(() => uuidv4());
  const [isCreating, setIsCreating] = useState(false);

  // Ref pattern to break circular dep: candidates needs poses.clearPosePhotos,
  // poses needs candidates.selectedCandidate. The ref is stable and always current.
  const clearPosesRef = useRef<() => void>(() => {});

  const candidates = useAiCandidates({
    selectedClientId,
    draftModelId,
    identityForm,
    onResetPoses: () => clearPosesRef.current(),
    onAdvanceToStep2: () => setWizardStep(2),
  });

  const poses = useAiPoses({
    selectedClientId,
    draftModelId,
    selectedCandidate: candidates.selectedCandidate,
    identityForm,
  });

  // Keep ref pointing to the latest clearPosePhotos on every render
  clearPosesRef.current = poses.clearPosePhotos;

  const busy =
    candidates.generatingCandidates ||
    poses.generatingPoses ||
    candidates.regeneratingCandidateIndex !== null ||
    poses.regeneratingPoseIndex !== null;

  const canGenerateCandidates = candidates.canGenerateCandidates(newModelName);
  const canSaveModel = Boolean(
    poses.acceptedPoseCount > 0 && newModelName.trim() && selectedClientId,
  );

  const canSelectStep = useCallback(
    (stepId: number): boolean =>
      canSelectWizardStep({
        targetStep: stepId,
        currentStep: wizardStep,
        maxStep: AI_WIZARD_MAX_STEP,
        isStepComplete: (candidateStepId) =>
          isAiWizardStepComplete({
            stepId: candidateStepId,
            candidates: candidates.candidates,
            selectedCandidate: candidates.selectedCandidate,
          }),
      }),
    [candidates.candidates, candidates.selectedCandidate, wizardStep],
  );

  const resetFlow = useCallback(() => {
    candidates.resetCandidates();
    poses.resetPoses();
    setWizardStep(1);
    identityForm.restoreAutoPrompt();
  }, [candidates, identityForm, poses]);

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

  const handleCreateFromAI = useCallback(async () => {
    const trimmedName = newModelName.trim();
    if (!trimmedName || !selectedClientId) return;

    const accepted = poses.posePhotos
      .filter((photo) => !photo.rejected && !photo.loading)
      .map((photo) => {
        const recipe = photo.poseRecipeId
          ? MODEL_POSE_RECIPES_BY_ID.get(photo.poseRecipeId)
          : undefined;

        return {
          storagePath: photo.storagePath,
          contentType: photo.contentType,
          aiClassification: recipe ? buildManualPoseClassification(recipe) : null,
        };
      });

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
        identityTraits: buildModelIdentityTraitsFromAiForm({
          sex: identityForm.sex,
          age: identityForm.age,
          skin: identityForm.skin,
          hairColor: identityForm.hairColor,
          hairLength: identityForm.hairLength,
          build: identityForm.build,
        }),
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
    identityForm.age,
    identityForm.build,
    identityForm.hairColor,
    identityForm.hairLength,
    identityForm.sex,
    identityForm.skin,
    newModelName,
    onSuccess,
    poses.posePhotos,
    resetFlow,
    selectedClientId,
    setNewModelName,
    setSelectedClientId,
    toast,
  ]);

  const { canGenerateCandidates: _cgc, resetCandidates: _rc, ...candidatesApi } = candidates;
  const { clearPosePhotos: _cpp, resetPoses: _rp, ...posesApi } = poses;

  return {
    isCreating,
    ai: {
      ...identityForm,
      ...candidatesApi,
      ...posesApi,
      wizardSteps: AI_WIZARD_STEPS,
      identityCandidateCount: IDENTITY_CANDIDATE_COUNT,
      wizardStep,
      busy,
      canGenerateCandidates,
      canSaveModel,
      canSelectStep,
      handleStepSelect,
      handleContinueToPoseStep: () => setWizardStep(3),
      handleCreateFromAI,
    },
  };
};
