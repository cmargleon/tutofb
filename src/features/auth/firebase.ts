import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

interface SyncUserClaimsResponse {
  success: boolean;
  uid: string;
  role: string;
  active: boolean;
}

export const syncUserClaims = async (uid?: string) => {
  const callable = httpsCallable<{ uid?: string }, SyncUserClaimsResponse>(functions, 'syncUserClaims');
  const result = await callable(uid ? { uid } : {});
  return result.data;
};
