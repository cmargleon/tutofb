import { useEffect, useState } from 'react';
import type { Job, JobLog } from '../../../shared/src/types';
import { getJobReviewReferencePaths, needsLegacyJobReviewReferences } from '../../../shared/src/jobReview';
import { subscribeJobRejections, subscribeLegacyJobReferences } from './firebase';

export const useJobReviewReferences = (job: Job) => {
  const [legacyPaths, setLegacyPaths] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const { clientId, batchId, garmentId } = job;
  const legacy = needsLegacyJobReviewReferences(job) && Boolean(clientId && batchId && garmentId);
  useEffect(() => {
    if (!legacy) return;
    return subscribeLegacyJobReferences({ clientId, batchId, garmentId }, paths => {
      setLegacyPaths(paths);
      setError(false);
    }, () => setError(true));
  }, [legacy, clientId, batchId, garmentId]);

  return { paths: [...new Set([...getJobReviewReferencePaths(job), ...(legacy ? legacyPaths : [])])], error };
};

export const useJobRejections = (jobId: string, outputId: string) => {
  const [state, setState] = useState<{ entries: JobLog[]; loading: boolean; error: boolean }>({
    entries: [], loading: true, error: false,
  });
  useEffect(() => subscribeJobRejections(jobId, outputId,
    entries => setState({ entries, loading: false, error: false }),
    () => setState({ entries: [], loading: false, error: true })), [jobId, outputId]);

  return state;
};
