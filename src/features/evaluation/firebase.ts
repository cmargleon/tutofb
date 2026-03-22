import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import {
  CancelPendingBatchJobsResponse,
  Provider,
  RegenerateFailedBatchJobsResponse,
  RegenerateJobsBulkRequest,
  RegenerateJobsBulkResponse,
} from '../../../shared/src/types';

export const regenerateJob = async (jobId: string, provider: Provider, prompt: string) => {
  const regenerateJobCallable = httpsCallable(functions, 'regenerateJob');
  try {
    const result = await regenerateJobCallable({ jobId, provider, prompt });
    return result.data;
  } catch (error) {
    console.error('Error calling regenerateJob:', error);
    throw error;
  }
};

export const regenerateFailedBatchJobs = async (batchId: string): Promise<RegenerateFailedBatchJobsResponse> => {
  const callable = httpsCallable<{ batchId: string }, RegenerateFailedBatchJobsResponse>(
    functions,
    'regenerateFailedBatchJobs',
  );

  try {
    const result = await callable({ batchId });
    return result.data;
  } catch (error) {
    console.error('Error calling regenerateFailedBatchJobs:', error);
    throw error;
  }
};

export const cancelPendingBatchJobs = async (batchId: string): Promise<CancelPendingBatchJobsResponse> => {
  const callable = httpsCallable<{ batchId: string }, CancelPendingBatchJobsResponse>(
    functions,
    'cancelPendingBatchJobs',
  );

  try {
    const result = await callable({ batchId });
    return result.data;
  } catch (error) {
    console.error('Error calling cancelPendingBatchJobs:', error);
    throw error;
  }
};

export const regenerateJobsBulk = async (
  jobs: RegenerateJobsBulkRequest['jobs'],
): Promise<RegenerateJobsBulkResponse> => {
  const callable = httpsCallable<RegenerateJobsBulkRequest, RegenerateJobsBulkResponse>(
    functions,
    'regenerateJobsBulk',
  );

  try {
    const result = await callable({ jobs });
    return result.data;
  } catch (error) {
    console.error('Error calling regenerateJobsBulk:', error);
    throw error;
  }
};
