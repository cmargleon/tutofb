import { db, auth, storage } from '../../firebase';
import { collection, collectionGroup, doc, setDoc, updateDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import {
  Client,
  ImportClientSpreadsheetTemplateRequest,
  ImportClientSpreadsheetTemplateResponse,
  SpreadsheetTemplate,
  SpreadsheetTemplateCategory,
  UpdateClientSpreadsheetTemplateCategoryRequest,
  UpdateClientSpreadsheetTemplateCategoryResponse,
} from '../../../shared/src/types';
import { isActiveCatalogEntity } from '../../../shared/src/domain';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { PermanentDeleteCatalogEntityRequest, PermanentDeleteCatalogEntityResponse } from '../../../shared/src/types';

interface SubscribeClientsOptions {
  includeArchived?: boolean;
}

const normalizeClientGenerationPrompt = (prompt: string): string | null => {
  const trimmed = prompt.trim();
  return trimmed ? trimmed : null;
};

export const subscribeToClients = (
  callback: (clients: Client[]) => void,
  onError: (error: Error) => void,
  options: SubscribeClientsOptions = {},
) => {
  const q = query(collection(db, 'clients'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const clients = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Client))
      .filter((client) => options.includeArchived ? true : isActiveCatalogEntity(client));
    callback(clients);
  }, onError);
};

export const subscribeToSpreadsheetTemplates = (
  callback: (templates: SpreadsheetTemplate[]) => void,
  onError: (error: Error) => void,
) => {
  const q = query(collectionGroup(db, 'spreadsheetTemplates'));
  return onSnapshot(q, (snapshot) => {
    const templates = snapshot.docs.map((templateDoc) => ({
      id: templateDoc.id,
      ...templateDoc.data(),
    } as SpreadsheetTemplate));
    callback(templates);
  }, onError);
};

export const subscribeToClientSpreadsheetTemplates = (
  clientId: string,
  callback: (templates: SpreadsheetTemplate[]) => void,
  onError: (error: Error) => void,
) => {
  const q = query(collection(db, 'clients', clientId, 'spreadsheetTemplates'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const templates = snapshot.docs.map((templateDoc) => ({
      id: templateDoc.id,
      ...templateDoc.data(),
    } as SpreadsheetTemplate));
    callback(templates);
  }, onError);
};

export const subscribeToSpreadsheetTemplateCategories = (
  clientId: string,
  templateId: string,
  callback: (categories: SpreadsheetTemplateCategory[]) => void,
  onError: (error: Error) => void,
) => {
  const q = query(collection(db, 'clients', clientId, 'spreadsheetTemplates', templateId, 'categories'), orderBy('sheetName', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const categories = snapshot.docs.map((categoryDoc) => ({
      id: categoryDoc.id,
      ...categoryDoc.data(),
    } as SpreadsheetTemplateCategory));
    callback(categories);
  }, onError);
};

export const createClient = async (name: string, generationPromptBase: string = '') => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  
  const newClientRef = doc(collection(db, 'clients'));
  const clientData: Omit<Client, 'id'> = {
    name: name.trim(),
    generationPromptBase: normalizeClientGenerationPrompt(generationPromptBase),
    status: 'active',
    archivedAt: null,
    archivedByUid: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    batchCount: 0,
    lastBatchCreatedAt: null,
    createdByUid: auth.currentUser.uid
  };
  
  await setDoc(newClientRef, clientData);
  return newClientRef.id;
};

export const updateClient = async (id: string, name: string, generationPromptBase: string = '') => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  
  const clientRef = doc(db, 'clients', id);
  await updateDoc(clientRef, {
    name: name.trim(),
    generationPromptBase: normalizeClientGenerationPrompt(generationPromptBase),
    updatedAt: serverTimestamp()
  });
};

const sanitizeFileName = (fileName: string) => fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

export const importClientSpreadsheetTemplate = async (
  clientId: string,
  file: File,
): Promise<ImportClientSpreadsheetTemplateResponse> => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const storagePath = `client_spreadsheets/${clientId}/${crypto.randomUUID()}/${sanitizeFileName(file.name)}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const callable = httpsCallable<ImportClientSpreadsheetTemplateRequest, ImportClientSpreadsheetTemplateResponse>(
    functions,
    'importClientSpreadsheetTemplate',
    { timeout: 300000 },
  );

  const result = await callable({
    clientId,
    storagePath,
    originalFileName: file.name,
  });

  return result.data;
};

export const updateClientSpreadsheetTemplateCategory = async (
  clientId: string,
  templateId: string,
  categoryId: string | null,
): Promise<UpdateClientSpreadsheetTemplateCategoryResponse> => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const callable = httpsCallable<
    UpdateClientSpreadsheetTemplateCategoryRequest,
    UpdateClientSpreadsheetTemplateCategoryResponse
  >(functions, 'updateClientSpreadsheetTemplateCategory');

  const result = await callable({
    clientId,
    templateId,
    categoryId,
  });

  return result.data;
};

export const archiveClient = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const clientRef = doc(db, 'clients', id);
  await updateDoc(clientRef, {
    status: 'archived',
    archivedAt: serverTimestamp(),
    archivedByUid: auth.currentUser.uid,
    updatedAt: serverTimestamp()
  });
};

export const restoreClient = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const clientRef = doc(db, 'clients', id);
  await updateDoc(clientRef, {
    status: 'active',
    archivedAt: null,
    archivedByUid: null,
    updatedAt: serverTimestamp()
  });
};

export const permanentlyDeleteClient = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const callable = httpsCallable<PermanentDeleteCatalogEntityRequest, PermanentDeleteCatalogEntityResponse>(
    functions,
    'permanentlyDeleteClient',
  );
  await callable({ id });
};
