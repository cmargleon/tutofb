import { storage, auth } from '../../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { UploadedGarmentDraft } from './types';

export const uploadGarmentDraft = async (
  draftBatchId: string,
  garment: UploadedGarmentDraft
): Promise<string> => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const storagePath = `garments/drafts/${auth.currentUser.uid}/${draftBatchId}/${garment.id}.jpg`;
  const storageRef = ref(storage, storagePath);

  // If it's multi-angle, we need to upload the composed previewUrl (which is a data URL)
  // If it's single, we can upload the file directly
  
  let uploadPromise;
  if (garment.isMultiAngle) {
    // Convert data URL to Blob
    const response = await fetch(garment.previewUrl);
    const blob = await response.blob();
    uploadPromise = uploadBytes(storageRef, blob);
  } else {
    // Single file
    uploadPromise = uploadBytes(storageRef, garment.files[0]);
  }

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
