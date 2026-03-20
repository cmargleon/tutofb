import { useState, useCallback } from 'react';
import { Job, Provider } from '../../../shared/src/types';
import { regenerateJob } from './firebase';

export const useJobRegenerationFirebase = (jobs: Job[]) => {
  const [localDrafts, setLocalDrafts] = useState<Record<string, { provider: Provider; prompt: string }>>({});
  const [queueingJobs, setQueueingJobs] = useState<Record<string, boolean>>({});
  const [regenerationErrors, setRegenerationErrors] = useState<Record<string, string | null>>({});

  // Initialize drafts for jobs that don't have one yet
  const initializeDraft = useCallback((job: Job) => {
    setLocalDrafts(prev => {
      if (prev[job.id!]) return prev;
      return {
        ...prev,
        [job.id!]: {
          provider: job.provider,
          prompt: job.promptBase || job.finalPrompt || ''
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
      return;
    }

    setQueueingJobs(prev => ({ ...prev, [jobId]: true }));
    setRegenerationErrors(prev => ({ ...prev, [jobId]: null }));

    try {
      await regenerateJob(jobId, draft.provider, draft.prompt);
    } catch (error: any) {
      setRegenerationErrors(prev => ({ ...prev, [jobId]: error.message || 'Error al encolar regeneración' }));
    } finally {
      setQueueingJobs(prev => ({ ...prev, [jobId]: false }));
    }
  }, [localDrafts]);

  return {
    localDrafts,
    queueingJobs,
    regenerationErrors,
    initializeDraft,
    updateDraft,
    handleRegenerate
  };
};
