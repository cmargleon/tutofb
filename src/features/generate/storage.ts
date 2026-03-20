import { storage, auth } from '../../firebase';
import { ref, uploadBytes, deleteObject } from 'firebase/storage';
import { UploadedGarmentDraft } from './types';

export const uploadGarmentDraft = async (
  draftBatchId: string,
  garment: UploadedGarmentDraft
): Promise<string> => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const storagePath = `garments/drafts/${auth.currentUser.uid}/${draftBatchId}/${garment.id}.jpg`;
  const storageRef = ref(storage, storagePath);
  const uploadPromise = uploadBytes(storageRef, garment.uploadFile, {
    contentType: garment.uploadFile.type || 'image/jpeg',
  });

  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('El tiempo de subida ha expirado. Verifica tu conexión o la configuración de Firebase Storage.')), 30000)
  );
  
  await Promise.race([uploadPromise, timeoutPromise]);

  return storagePath;
};

export const deleteGarmentDrafts = async (
  draftBatchId: string,
  garments: UploadedGarmentDraft[]
) => {
  if (!auth.currentUser) return;

  for (const garment of garments) {
    const storagePath = `garments/drafts/${auth.currentUser.uid}/${draftBatchId}/${garment.id}.jpg`;
    const storageRef = ref(storage, storagePath);
    try {
      await deleteObject(storageRef);
    } catch (error) {
      console.error('Failed to delete draft garment', error);
    }
  }
};
