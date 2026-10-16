import { useState, useCallback } from 'react';
import { Job, Provider } from '../../../shared/src/types';
import { cancelJobGeneration, regenerateJob, retryJobAutoReview } from './firebase';

export const useJobRegenerationFirebase = () => {
  const [localDrafts, setLocalDrafts] = useState<Record<string, { provider: Provider; prompt: string }>>({});
  const [queueingJobs, setQueueingJobs] = useState<Record<string, boolean>>({});
  const [regenerationErrors, setRegenerationErrors] = useState<Record<string, string | null>>({});
  const [retryingAutoReviewJobs, setRetryingAutoReviewJobs] = useState<Record<string, boolean>>({});
  const [autoReviewRetryErrors, setAutoReviewRetryErrors] = useState<Record<string, string | null>>({});
  const [cancellingJobs, setCancellingJobs] = useState<Record<string, boolean>>({});
  const [cancellationErrors, setCancellationErrors] = useState<Record<string, string | null>>({});

  // Initialize drafts for jobs that don't have one yet
  const initializeDraft = useCallback((job: Job) => {
    setLocalDrafts(prev => {
      if (prev[job.id!]) return prev;
      return {
        ...prev,
        [job.id!]: {
          provider: job.provider,
          prompt: (job.generationKind === 'product' ? job.requestedPromptBase : null) || job.promptBase || job.finalPrompt || ''
        }
      };
    });
  }, []);

  const updateDraft = useCallback((jobId: string, updates: Partial<{ provider: Provider; prompt: string }>) => {
    setLocalDrafts(prev => ({
      ...prev,
      [jobId]: { ...prev[jobId], ...updates } as { provider: Provider; prompt: string }
    }));
  }, []);

  const handleRegenerate = useCallback(async (jobId: string) => {
    const draft = localDrafts[jobId];
    if (!draft || !draft.prompt.trim()) {
      setRegenerationErrors(prev => ({ ...prev, [jobId]: 'El prompt no puede estar vacío' }));
      return false;
    }

    setQueueingJobs(prev => ({ ...prev, [jobId]: true }));
    setRegenerationErrors(prev => ({ ...prev, [jobId]: null }));

    try {
      await regenerateJob(jobId, draft.provider, draft.prompt);
      return true;
    } catch (error: any) {
      setRegenerationErrors(prev => ({ ...prev, [jobId]: error.message || 'Error al encolar regeneración' }));
      return false;
    } finally {
      setQueueingJobs(prev => ({ ...prev, [jobId]: false }));
    }
  }, [localDrafts]);

  const handleCancelGeneration = useCallback(async (jobId: string) => {
    setCancellingJobs(prev => ({ ...prev, [jobId]: true }));
    setCancellationErrors(prev => ({ ...prev, [jobId]: null }));

    try {
      await cancelJobGeneration(jobId);
    } catch (error: any) {
      setCancellationErrors(prev => ({
        ...prev,
        [jobId]: error.message || 'No pudimos cancelar esta generación',
      }));
      throw error;
    } finally {
      setCancellingJobs(prev => ({ ...prev, [jobId]: false }));
    }
  }, []);

  const handleRetryAutoReview = useCallback(async (jobId: string) => {
    setRetryingAutoReviewJobs((prev) => ({ ...prev, [jobId]: true }));
    setAutoReviewRetryErrors((prev) => ({ ...prev, [jobId]: null }));

    try {
      await retryJobAutoReview(jobId);
    } catch (error: any) {
      setAutoReviewRetryErrors((prev) => ({
        ...prev,
        [jobId]: error?.message || 'No pudimos reintentar la revisión automática',
      }));
    } finally {
      setRetryingAutoReviewJobs((prev) => ({ ...prev, [jobId]: false }));
    }
  }, []);

  return {
    localDrafts,
    queueingJobs,
    regenerationErrors,
    retryingAutoReviewJobs,
    autoReviewRetryErrors,
    cancellingJobs,
    cancellationErrors,
    initializeDraft,
    updateDraft,
    handleRegenerate,
    handleRetryAutoReview,
    handleCancelGeneration,
  };
};
