import { httpsCallable } from 'firebase/functions';
import { SystemHealthSnapshot } from '../../../shared/src/types';
import { functions } from '../../firebase';

export const getSystemHealth = async (): Promise<SystemHealthSnapshot> => {
  const callable = httpsCallable<Record<string, never>, SystemHealthSnapshot>(functions, 'getSystemHealth');
  const result = await callable({});
  return result.data;
};
