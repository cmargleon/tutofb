import { useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useConfirm, useToast } from '../../feedback/FeedbackProvider';
import { IDENTITY_CANDIDATE_COUNT } from '../constants';
import { toCandidatePhotoState } from '../aiWizard';
import { generateModelPoses } from '../firebase';
import { GeneratedPhotoState } from '../types';
import type { AiIdentityFormState } from './useAiIdentityForm';

interface UseAiCandidatesParams {
  selectedClientId: string;
  draftModelId: string;
  identityForm: Pick<AiIdentityFormState, 'prompt' | 'provider' | 'aspectRatio'>;
  onResetPoses: () => void;
  onAdvanceToStep2: () => void;
}

export interface UseAiCandidatesReturn {
  candidates: GeneratedPhotoState[];
  selectedCandidateIndex: number | null;
  selectedCandidate: GeneratedPhotoState | null;
  generatingCandidates: boolean;
  regeneratingCandidateIndex: number | null;
  canGenerateCandidates: (modelName: string) => boolean;
  handleGenerateCandidates: () => Promise<void>;
  handleSelectCandidate: (index: number) => void;
  handleRegenerateCandidate: (index: number) => Promise<void>;
  resetCandidates: () => void;
}

export const useAiCandidates = ({
  selectedClientId,
  draftModelId,
  identityForm,
  onResetPoses,
  onAdvanceToStep2,
}: UseAiCandidatesParams): UseAiCandidatesReturn => {
  const toast = useToast();
  const confirm = useConfirm();

  const [candidates, setCandidates] = useState<GeneratedPhotoState[]>([]);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number | null>(null);
  const [generatingCandidates, setGeneratingCandidates] = useState(false);
  const [regeneratingCandidateIndex, setRegeneratingCandidateIndex] = useState<number | null>(null);

  const selectedCandidate = useMemo(
    () => (selectedCandidateIndex !== null ? candidates[selectedCandidateIndex] ?? null : null),
    [candidates, selectedCandidateIndex],
  );

  const canGenerateCandidates = useCallback(
    (modelName: string) => Boolean(modelName.trim() && selectedClientId && identityForm.prompt.trim()),
    [identityForm.prompt, selectedClientId],
  );

  const resetCandidates = useCallback(() => {
    setCandidates([]);
    setSelectedCandidateIndex(null);
    setRegeneratingCandidateIndex(null);
    onResetPoses();
  }, [onResetPoses]);

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
    onResetPoses();

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

      onAdvanceToStep2();
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
    onAdvanceToStep2,
    onResetPoses,
    selectedClientId,
    toast,
  ]);

  const handleSelectCandidate = useCallback((index: number) => {
    setSelectedCandidateIndex(index);
    onResetPoses();
  }, [onResetPoses]);

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
              photoIndex === index ? toCandidatePhotoState(newPhoto) : photo,
            ),
          );
          if (selectedCandidateIndex === index) {
            onResetPoses();
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
      onResetPoses,
      selectedCandidateIndex,
      selectedClientId,
      toast,
    ],
  );

  return {
    candidates,
    selectedCandidateIndex,
    selectedCandidate,
    generatingCandidates,
    regeneratingCandidateIndex,
    canGenerateCandidates,
    handleGenerateCandidates,
    handleSelectCandidate,
    handleRegenerateCandidate,
    resetCandidates,
  };
};
