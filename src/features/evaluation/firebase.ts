import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { Provider } from '../../../shared/src/types';

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
