import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useConfirm, useToast } from '../../feedback/FeedbackProvider';
import { AI_WIZARD_MAX_STEP, AI_WIZARD_STEPS, IDENTITY_CANDIDATE_COUNT } from '../constants';
import { isAiWizardStepComplete } from '../aiWizard';
import { createModelFromPaths, approveGeneratedModelIdentity, subscribeToModel } from '../firebase';
import { buildModelIdentityTraitsFromAiForm } from '../identityTraits';
import type { Model, Client } from '../../../../shared/src/types';
import { subscribeToClient } from '../../clients/firebase';
import { AiIdentityFormState, useAiIdentityForm } from './useAiIdentityForm';
import { useAiCandidates, UseAiCandidatesReturn } from './useAiCandidates';
import { canSelectWizardStep } from '../../wizard/navigation';

interface UseAiWizardParams {
  newModelName: string;
  selectedClientId: string;
  disabledProviders?: string[];
  setNewModelName: (value: string) => void;
  setSelectedClientId: (value: string) => void;
  onSuccess: () => void;
}

export interface ModelCreateFlowAiState
  extends AiIdentityFormState,
    Omit<UseAiCandidatesReturn, 'canGenerateCandidates' | 'resetCandidates'> {
  wizardSteps: typeof AI_WIZARD_STEPS;
  identityCandidateCount: typeof IDENTITY_CANDIDATE_COUNT;
  wizardStep: number;
  busy: boolean;
  createProgress: string | null;
  createError: string | null;
  canGenerateCandidates: boolean;
  generateCandidatesDisabledReason: string | null;
  savedModel: Model | null;
  identityLocked: boolean;
  handleStartAnotherModel: () => Promise<void>;
  savedClient: Client | null;
  setsBusy: boolean;
  setSetsBusy: (busy: boolean) => void;
  canSelectStep: (stepId: number) => boolean;
  handleStepSelect: (stepId: number) => Promise<void>;
  handleContinueToPoseStep: () => Promise<void>;
  handleCreateFromAI: () => Promise<void>;
}

export interface UseAiWizardResult {
  ai: ModelCreateFlowAiState;
  isCreating: boolean;
}

export const useAiWizard = ({
  newModelName,
  selectedClientId,
  disabledProviders,
  setNewModelName,
  setSelectedClientId,
  onSuccess,
}: UseAiWizardParams): UseAiWizardResult => {
  const toast = useToast();
  const confirm = useConfirm();
  const identityForm = useAiIdentityForm({ disabledProviders });

  const [wizardStep, setWizardStep] = useState(1);
  const [draftModelId, setDraftModelId] = useState(() => uuidv4());
  const [isCreating, setIsCreating] = useState(false);
  const creatingRef = useRef(false);
  const [createProgress, setCreateProgress] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [savedModelId, setSavedModelId] = useState<string | null>(null);
  const [savedModel, setSavedModel] = useState<Model | null>(null);
  const [savedClient, setSavedClient] = useState<Client | null>(null);
  const [setsBusy, setSetsBusy] = useState(false);
  useEffect(() => savedModelId ? subscribeToModel(savedModelId, setSavedModel, error => toast({ tone: 'error', title: 'No se pudo cargar el modelo', description: error.message })) : undefined, [savedModelId, toast]);
  useEffect(() => selectedClientId ? subscribeToClient(selectedClientId, setSavedClient, error => toast({ tone: 'error', title: 'No se pudo cargar el cliente', description: error.message })) : undefined, [selectedClientId, toast]);
  const candidates = useAiCandidates({
    selectedClientId, draftModelId, identityForm,
    onResetPoses: () => {},
    onAdvanceToStep2: () => setWizardStep(2),
  });
  const busy = isCreating || setsBusy || candidates.generatingCandidates || candidates.regeneratingCandidateIndex !== null;

  const canGenerateCandidates = candidates.canGenerateCandidates(newModelName);
  const generateCandidatesDisabledReason = !newModelName.trim()
    ? 'Falta completar el campo "Nombre del modelo".'
    : !selectedClientId
      ? 'Falta seleccionar el campo "Cliente".'
      : !identityForm.prompt.trim()
        ? 'Falta completar el campo "Prompt de identidad".'
        : identityForm.selectedProviderDisabled
          ? 'El campo "Proveedor IA" no es válido porque el proveedor está deshabilitado.'
          : null;
  const canSelectStep = useCallback(
    (stepId: number): boolean =>
      !busy && (!savedModelId || stepId === 3) && canSelectWizardStep({
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
    [busy, savedModelId, candidates.candidates, candidates.selectedCandidate, wizardStep],
  );

  const resetFlow = useCallback(() => {
    setCreateError(null);
    candidates.resetCandidates();
    setSavedModelId(null); setSavedModel(null); setDraftModelId(uuidv4());
    setWizardStep(1);
    identityForm.restoreAutoPrompt();
  }, [candidates, identityForm]);

  const handleCreateFromAI = useCallback(async () => {
    if (creatingRef.current || busy || !candidates.selectedCandidate || !newModelName.trim() || !selectedClientId) return;
    creatingRef.current = true;
    setIsCreating(true);
    setCreateError(null);
    let modelId = savedModelId;
    try {
      // Save once; a failed approval retries against the same model without losing identity.
      if (!modelId) {
        setCreateProgress('Guardando modelo…');
        modelId = await createModelFromPaths(selectedClientId, newModelName.trim(), [candidates.selectedCandidate], {
          modelId: draftModelId,
          identityTraits: buildModelIdentityTraitsFromAiForm(identityForm),
        });
        setSavedModelId(modelId);
      }
      setCreateProgress('Aprobando identidad…');
      await approveGeneratedModelIdentity(modelId, candidates.selectedCandidate.storagePath);
      setCreateProgress('Preparando poses…');
      // Let the status paint before mounting the pose setup.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      setWizardStep(3);
      onSuccess();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Inténtalo de nuevo.';
      const description = modelId ? `El modelo quedó guardado. Puedes reintentar la aprobación con Continuar a Poses sin crear otro modelo. ${detail}` : detail;
      setCreateError(description);
      toast({ tone: 'error', title: 'No se pudo preparar la identidad', description });
    } finally { creatingRef.current = false; setIsCreating(false); setCreateProgress(null); }
  }, [busy, candidates.selectedCandidate, newModelName, selectedClientId, savedModelId, draftModelId, identityForm, onSuccess, toast]);

  const handleStepSelect = useCallback(
    async (stepId: number) => {
      if (busy || savedModelId) return;
      if (stepId === 3) { await handleCreateFromAI(); return; }
      if (stepId === 1 && wizardStep > 1) {
        const accepted = await confirm({
          title: 'Reiniciar flujo de IA',
          description: 'Volver al paso 1 reiniciará los candidatos y la selección actual.',
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
    [busy, savedModelId, handleCreateFromAI, canSelectStep, confirm, resetFlow, wizardStep],
  );

  const { canGenerateCandidates: _cgc, resetCandidates: _rc, ...candidatesApi } = candidates;

  return {
    isCreating,
    ai: {
      ...identityForm,
      ...candidatesApi,
      wizardSteps: AI_WIZARD_STEPS,
      identityCandidateCount: IDENTITY_CANDIDATE_COUNT,
      wizardStep,
      busy,
      createProgress, createError,
      canGenerateCandidates,
      generateCandidatesDisabledReason,
      savedModel, savedClient, setsBusy, setSetsBusy,
      identityLocked: Boolean(savedModelId),
      handleStartAnotherModel: async () => {
        if (busy || !await confirm({ title: 'Crear otro modelo', description: 'El modelo actual, sus fotos y verificaciones se conservarán en el catálogo.', confirmLabel: 'Crear otro modelo' })) return;
        resetFlow(); setNewModelName(''); setSelectedClientId(''); setSavedClient(null);
      },
      canSelectStep,
      handleStepSelect,
      handleContinueToPoseStep: handleCreateFromAI,
      handleCreateFromAI,
    },
  };
};
