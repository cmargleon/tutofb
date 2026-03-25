import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import {
  ClassifyGarmentViewsRequest,
  ClassifyGarmentViewsResponse,
  CreateGenerationBatchRequest,
  CreateGenerationBatchResponse,
} from '../../../shared/src/types';

export const createGenerationBatch = async (data: CreateGenerationBatchRequest): Promise<CreateGenerationBatchResponse> => {
  const callable = httpsCallable<CreateGenerationBatchRequest, CreateGenerationBatchResponse>(
    functions, 
    'createGenerationBatch'
  );
  
  const result = await callable(data);
  return result.data;
};

export const classifyGarmentViewsWithGemini = async (
  data: ClassifyGarmentViewsRequest,
): Promise<ClassifyGarmentViewsResponse> => {
  const callable = httpsCallable<ClassifyGarmentViewsRequest, ClassifyGarmentViewsResponse>(
    functions,
    'classifyGarmentViewsWithGemini',
  );

  const result = await callable(data);
  return result.data;
};
