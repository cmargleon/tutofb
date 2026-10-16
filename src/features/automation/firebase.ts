import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { AutomationJob, AutomationJobReceipt, CreateAutomationJobRequest, RetryAutomationJobRequest } from '../../../shared/src/types';
import { db, functions } from '../../firebase';

export const createAutomation = async (data: CreateAutomationJobRequest) =>
  (await httpsCallable<CreateAutomationJobRequest, AutomationJobReceipt>(functions, 'createAutomationJob')(data)).data;
export const retryAutomation = async (data: RetryAutomationJobRequest) =>
  (await httpsCallable<RetryAutomationJobRequest, AutomationJobReceipt>(functions, 'retryAutomationJob')(data)).data;
export const subscribeToAutomationJobs = (uid: string, admin: boolean, callback: (jobs: AutomationJob[]) => void, onError: (error: Error) => void) => {
  const source = collection(db, 'automationJobs');
  const q = admin ? query(source, orderBy('createdAt', 'desc'), limit(100))
    : query(source, where('createdByUid', '==', uid), orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(q, (snapshot) => callback(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as AutomationJob))), onError);
};
