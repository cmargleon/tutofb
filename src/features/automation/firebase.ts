import { subscribeHumanQuery } from '../auth/scopedQuery';
import type { AutomationPlanSummary, ResumeAutomationRequest } from '../../../shared/src/types';
import { auth } from '../../firebase';
import firebaseConfig from '../../../firebase-applet-config.json';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
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
  return subscribeHumanQuery(q, 'clientId', (snapshot) => callback(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as AutomationJob))), onError);
};

export const prepareAutomationPlan = async (data: CreateAutomationJobRequest) =>
  (await httpsCallable<CreateAutomationJobRequest, AutomationPlanSummary>(functions, 'createAutomationPlan')(data)).data;
export const executeAutomationPlan = async (planId: string) =>
  (await httpsCallable<{ planId: string }, AutomationJobReceipt>(functions, 'executeAutomationPlanCallable')({ planId })).data;
export const resumeAutomationJob = async (data: ResumeAutomationRequest) =>
  (await httpsCallable<ResumeAutomationRequest, { jobId: string; resumedScenes: number }>(functions, 'resumeAutomationJob')(data)).data;
export const downloadAutomationResults = async (jobId: string) => {
  if (!auth.currentUser || !/^[\w-]{1,200}$/.test(jobId)) throw new Error('Inicia sesión para descargar.');
  const base = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
    ? `http://127.0.0.1:5001/${firebaseConfig.projectId}/us-central1/automationApi`
    : `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/automationApi`;
  const response = await fetch(`${base}/jobs/${jobId}/download`, { headers: { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } });
  if (!response.ok) throw new Error('No se pudieron descargar los resultados aprobados.');
  return response.blob();
};

export const getAutomationPlan = async (planId: string) =>
  (await httpsCallable<{ planId: string }, AutomationPlanSummary>(functions, 'getAutomationPlan')({ planId })).data;
export const subscribeToAutomationJob = (id: string, callback: (job: AutomationJob | null) => void, onError: (error: Error) => void) =>
  onSnapshot(doc(db, 'automationJobs', id), (snapshot) => callback(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as AutomationJob : null), onError);
