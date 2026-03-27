import { functions } from '../../firebase';
import { db } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  CancelJobGenerationResponse,
  CancelPendingBatchJobsResponse,
  Provider,
  RegenerateFailedBatchJobsResponse,
  RegenerateJobsBulkRequest,
  RegenerateJobsBulkResponse,
  RetryJobAutoReviewRequest,
  RetryJobAutoReviewResponse,
  SelectJobOutputRequest,
  SelectJobOutputResponse,
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

export const retryJobAutoReview = async (
  jobId: string,
): Promise<RetryJobAutoReviewResponse> => {
  const callable = httpsCallable<RetryJobAutoReviewRequest, RetryJobAutoReviewResponse>(
    functions,
    'retryJobAutoReview',
  );

  try {
    const result = await callable({ jobId });
    return result.data;
  } catch (error) {
    console.error('Error calling retryJobAutoReview:', error);
    throw error;
  }
};

export const cancelJobGeneration = async (jobId: string): Promise<CancelJobGenerationResponse> => {
  const callable = httpsCallable<{ jobId: string }, CancelJobGenerationResponse>(functions, 'cancelJobGeneration');

  try {
    const result = await callable({ jobId });
    return result.data;
  } catch (error) {
    console.error('Error calling cancelJobGeneration:', error);
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

export const selectJobOutput = async (
  jobId: string,
  outputId: string | null,
): Promise<SelectJobOutputResponse> => {
  const callable = httpsCallable<SelectJobOutputRequest, SelectJobOutputResponse>(
    functions,
    'selectJobOutput',
  );

  try {
    const result = await callable({ jobId, outputId });
    return result.data;
  } catch (error) {
    console.error('Error calling selectJobOutput:', error);
    throw error;
  }
};

export const setJobManualFlag = async (
  jobId: string,
  flagged: boolean,
  userUid: string | null,
) => {
  const jobRef = doc(db, 'jobs', jobId);

  await updateDoc(jobRef, {
    manuallyFlagged: flagged,
    manuallyFlaggedAt: flagged ? serverTimestamp() : null,
    manuallyFlaggedByUid: flagged ? userUid : null,
    updatedAt: serverTimestamp(),
  });
};
