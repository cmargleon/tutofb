import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../../firebase';
import { ArchiveSearchRequest, ArchiveSearchResponse } from '../../../shared/src/types';

const isUnauthenticatedError = (error: unknown) =>
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && typeof error.code === 'string'
  && error.code.endsWith('unauthenticated');

export const searchArchive = async (request: ArchiveSearchRequest): Promise<ArchiveSearchResponse> => {
  const callable = httpsCallable<ArchiveSearchRequest, ArchiveSearchResponse>(functions, 'searchArchive');

  try {
    const result = await callable(request);
    return result.data;
  } catch (error) {
    if (auth.currentUser && isUnauthenticatedError(error)) {
      await auth.currentUser.getIdToken(true);
      const retryResult = await callable(request);
      return retryResult.data;
    }

    throw error;
  }
};
