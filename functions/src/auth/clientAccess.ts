import { HttpsError } from 'firebase-functions/v2/https';
import type { User } from '../../../shared/src/types';
import { humanClientIds } from '../../../shared/src/clientAccess';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';

export const loadHumanClientIds = async (uid: string): Promise<string[] | null> => {
  const user = (await getAppFirestore().collection('users').doc(uid).get()).data() as User | undefined;
  if (!user || user.active !== true || user.status === 'archived' || !['admin', 'operador', 'revisor'].includes(user.role))
    throw new HttpsError('permission-denied', 'La cuenta no está activa.');
  return humanClientIds(user);
};
export const assertHumanClientAccess = async (uid: string, clientId: unknown) => {
  const ids = await loadHumanClientIds(uid);
  if (ids !== null && !ids.includes(validId(clientId))) throw new HttpsError('permission-denied', 'Cliente fuera de tu alcance.');
};
export const assertHumanResourceAccess = async (uid: string, collection: string, id: unknown) => {
  const data = (await getAppFirestore().collection(collection).doc(validId(id)).get()).data();
  if (!data) throw new HttpsError('not-found', 'Recurso no disponible.');
  await assertHumanClientAccess(uid, data.clientId);
};

/** Resolve every referenced resource independently: a permitted clientId cannot hide a foreign jobId. */
export const authorizeHumanInput = async (uid: string, input: unknown, ids: string[] | null, resources: Record<string, string> = {}): Promise<void> => {
  if (ids === null) return;
  if (!input || typeof input !== 'object') return;
  const db = getAppFirestore();
  const checkClient = (id: unknown) => {
    if (!ids.includes(validId(id))) throw new HttpsError('permission-denied', 'Cliente fuera de tu alcance.');
  };
  const resource = async (collection: string, id: unknown) => {
    const data = (await db.collection(collection).doc(validId(id)).get()).data();
    if (!data) throw new HttpsError('not-found', 'Recurso no disponible.');
    checkClient(data.clientId);
  };
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === '') continue;
    if (key === 'clientId') checkClient(value);
    const collections: Record<string, string> = { jobId: 'jobs', batchId: 'batches', modelId: 'models', planId: 'automationPlans', automationJobId: 'automationJobs', ...resources };
    if (collections[key]) await resource(collections[key], value);
    if (key === 'jobIds' && Array.isArray(value)) for (const id of value) await resource('jobs', id);
    if (['storagePath', 'referenceStoragePath'].includes(key) && typeof value === 'string') {
      const parts = value.split('/');
      if (/[\\%?#]/.test(value) || parts.some(part => !part || part === '.' || part === '..')) throw new HttpsError('invalid-argument', 'Ruta inválida.');
      if (parts[0] === 'garments' && parts[1] === 'drafts' && parts[2] === uid) continue;
      if (parts[0] === 'wizard_source_spreadsheets' && parts[1] === uid) continue;
      if (['generated', 'models', 'client_spreadsheets', 'client_spreadsheet_exports', 'model_generations'].includes(parts[0])) checkClient(parts[1]);
      else throw new HttpsError('permission-denied', 'Archivo fuera de tu alcance.');
    }
    if (key === 'referencePaths' && Array.isArray(value)) for (const path of value) await authorizeHumanInput(uid, { storagePath: path }, ids, resources);
    if (typeof value === 'object') await authorizeHumanInput(uid, value, ids, resources);
  }
};
