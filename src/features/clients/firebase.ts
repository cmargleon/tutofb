import { db, auth } from '../../firebase';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, getDoc } from 'firebase/firestore';
import { Client } from '../../../shared/src/types';

export const subscribeToClients = (callback: (clients: Client[]) => void, onError: (error: Error) => void) => {
  const q = query(collection(db, 'clients'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const clients = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Client));
    callback(clients);
  }, onError);
};

export const createClient = async (name: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  
  const newClientRef = doc(collection(db, 'clients'));
  const clientData: Omit<Client, 'id'> = {
    name: name.trim(),
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

export const deleteClient = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  
  const clientRef = doc(db, 'clients', id);
  await deleteDoc(clientRef);
};
