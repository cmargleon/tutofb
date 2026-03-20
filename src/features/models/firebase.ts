import { db, auth, storage } from '../../firebase';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Model, Pose, Client } from '../../../shared/src/types';
import { v4 as uuidv4 } from 'uuid';

export const subscribeToModels = (callback: (models: Model[]) => void, onError: (error: Error) => void) => {
  const q = query(collection(db, 'models'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const models = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Model));
    callback(models);
  }, onError);
};

export const createModel = async (clientId: string, name: string, files: File[]) => {
  console.log('Starting createModel...', { clientId, name, filesCount: files.length });
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  
  // Get client name
  console.log('Fetching client info...');
  const clientRef = doc(db, 'clients', clientId);
  const clientSnap = await getDoc(clientRef);
  if (!clientSnap.exists()) throw new Error('Cliente no encontrado');
  const clientName = (clientSnap.data() as Client).name;
  console.log('Client info fetched:', clientName);

  // Generate model ID
  const newModelRef = doc(collection(db, 'models'));
  const modelId = newModelRef.id;
  console.log('Generated model ID:', modelId);

  const poses: Pose[] = [];
  const uploadedRefs: any[] = [];

  try {
    // Upload images
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`Uploading file ${i + 1}/${files.length}: ${file.name}`);
      const poseId = uuidv4();
      const fileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `models/${clientId}/${modelId}/poses/${poseId}-${fileName}`;
      const storageRef = ref(storage, storagePath);
      
      // Add a timeout to uploadBytes to prevent hanging
      const uploadPromise = uploadBytes(storageRef, file);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('El tiempo de subida ha expirado. Verifica tu conexión o la configuración de Firebase Storage.')), 30000)
      );
      
      await Promise.race([uploadPromise, timeoutPromise]);
      
      console.log(`File ${i + 1} uploaded successfully.`);
      uploadedRefs.push(storageRef);

      poses.push({
        id: poseId,
        storagePath,
        fileName,
        createdAt: new Date().toISOString() // Using ISO string for simplicity in array
      });
    }

    console.log('All files uploaded. Saving model document to Firestore...');
    const modelData: Omit<Model, 'id'> = {
      clientId,
      clientNameSnapshot: clientName,
      name: name.trim(),
      poses,
      poseCount: poses.length,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: auth.currentUser.uid
    };

    await setDoc(newModelRef, modelData);
    console.log('Model document saved successfully.');
    return modelId;
  } catch (error) {
    console.error('Error in createModel:', error);
    // Cleanup best effort
    for (const storageRef of uploadedRefs) {
      try {
        await deleteObject(storageRef);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    throw error;
  }
};

export const updateModel = async (id: string, name: string, clientId: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  
  // Get client name if client changed
  let clientNameSnapshot = undefined;
  if (clientId) {
    const clientRef = doc(db, 'clients', clientId);
    const clientSnap = await getDoc(clientRef);
    if (clientSnap.exists()) {
      clientNameSnapshot = (clientSnap.data() as Client).name;
    }
  }

  const modelRef = doc(db, 'models', id);
  const updates: any = {
    name: name.trim(),
    updatedAt: serverTimestamp()
  };

  if (clientId && clientNameSnapshot) {
    updates.clientId = clientId;
    updates.clientNameSnapshot = clientNameSnapshot;
  }

  await updateDoc(modelRef, updates);
};

export const deleteModel = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  
  const modelRef = doc(db, 'models', id);
  await deleteDoc(modelRef);
  // Note: Backend triggers should handle cascading deletes (storage, jobs, etc.)
};

export const getImageUrl = async (storagePath: string): Promise<string> => {
  try {
    const imageRef = ref(storage, storagePath);
    return await getDownloadURL(imageRef);
  } catch (error) {
    console.error('Error getting download URL:', error);
    return '';
  }
};
