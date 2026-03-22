import { db, auth } from '../../firebase';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, getDoc } from 'firebase/firestore';
import { Client } from '../../../shared/src/types';
import { isActiveCatalogEntity } from '../../../shared/src/domain';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { PermanentDeleteCatalogEntityRequest, PermanentDeleteCatalogEntityResponse } from '../../../shared/src/types';

interface SubscribeClientsOptions {
  includeArchived?: boolean;
}

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

export const createClient = async (name: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  
  const newClientRef = doc(collection(db, 'clients'));
  const clientData: Omit<Client, 'id'> = {
    name: name.trim(),
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

export const updateClient = async (id: string, name: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  
  const clientRef = doc(db, 'clients', id);
  await updateDoc(clientRef, {
    name: name.trim(),
    updatedAt: serverTimestamp()
  });
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
