import { httpsCallable } from 'firebase/functions';
import type { UpdateClientMarketplaceRequest, UpdateClientMarketplaceResponse } from '../../../shared/src/types';
import { functions } from '../../firebase';

export const updateClientMarketplace = async (
  input: UpdateClientMarketplaceRequest,
): Promise<UpdateClientMarketplaceResponse> => {
  const callable = httpsCallable<UpdateClientMarketplaceRequest, UpdateClientMarketplaceResponse>(
    functions,
    'updateClientMarketplace',
  );
  return (await callable(input)).data;
};
