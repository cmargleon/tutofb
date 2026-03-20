import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { CreateGenerationBatchRequest, CreateGenerationBatchResponse } from '../../../shared/src/types';

export const createGenerationBatch = async (data: CreateGenerationBatchRequest): Promise<CreateGenerationBatchResponse> => {
  const callable = httpsCallable<CreateGenerationBatchRequest, CreateGenerationBatchResponse>(
    functions, 
    'createGenerationBatch'
  );
  
  const result = await callable(data);
  return result.data;
};
