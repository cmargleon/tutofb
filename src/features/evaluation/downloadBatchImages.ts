import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Batch, Job } from '../../../shared/src/types';
import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from '../../firebase';

export const downloadBatchImages = async (batch: Batch, jobs: Job[]) => {
  const completedJobs = jobs.filter(job => job.status === 'completed' && job.currentOutput?.resultImagePath);
  
  if (completedJobs.length === 0) {
    throw new Error('No hay imágenes completadas para descargar.');
  }

  const zip = new JSZip();
  const folderName = `${batch.clientNameSnapshot}_${batch.modelNameSnapshot}_${batch.id}`;
  const folder = zip.folder(folderName);

  if (!folder) {
    throw new Error('Error al crear la carpeta ZIP.');
  }

  const fetchPromises = completedJobs.map(async (job, index) => {
    try {
      const imageRef = ref(storage, job.currentOutput!.resultImagePath);
      const url = await getDownloadURL(imageRef);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const blob = await response.blob();
      
      // Create a clean filename
      const cleanClientName = batch.clientNameSnapshot.replace(/[^a-zA-Z0-9]/g, '_');
      const cleanModelName = batch.modelNameSnapshot.replace(/[^a-zA-Z0-9]/g, '_');
      const cleanGarmentName = job.garmentName.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${cleanClientName}_${cleanModelName}_${cleanGarmentName}_pose${index + 1}_${job.id}.jpg`;
      
      folder.file(fileName, blob);
    } catch (error) {
      console.error(`Error downloading image for job ${job.id}:`, error);
      // We continue with other images even if one fails
    }
  });

  await Promise.all(fetchPromises);

  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `${folderName}.zip`);
};
