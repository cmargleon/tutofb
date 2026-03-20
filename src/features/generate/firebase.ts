import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { Provider, BackgroundConfig } from '../../../shared/src/types';

export interface CreateGenerationBatchRequest {
  clientId: string;
  modelId: string;
  poseIds: string[];
  garments: {
    id: string;
    name: string;
    storagePath: string;
    isMultiAngle: boolean;
  }[];
  provider: Provider;
  promptBase: string;
  aspectRatio: string;
  backgroundConfig: BackgroundConfig;
}

export interface CreateGenerationBatchResponse {
  batchId: string;
  jobCount: number;
}

export const createGenerationBatch = async (data: CreateGenerationBatchRequest): Promise<CreateGenerationBatchResponse> => {
  const callable = httpsCallable<CreateGenerationBatchRequest, CreateGenerationBatchResponse>(
    functions, 
    'createGenerationBatch'
  );
  
  const result = await callable(data);
  return result.data;
};
