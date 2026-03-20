import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { getBlob, getDownloadURL, ref } from 'firebase/storage';
import { Batch, Job } from '../../../shared/src/types';
import { storage } from '../../firebase';

const { saveAs } = FileSaver;

const normalizeFilename = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'archivo';

const isRemoteUrl = (value: string): boolean => value.startsWith('http://') || value.startsWith('https://');

const getExtension = (value: string): string => {
  const match = value.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() || 'png';
};

export const resolveStorageAssetUrl = async (storagePath: string): Promise<string> => {
  if (isRemoteUrl(storagePath)) {
    return storagePath;
  }

  return getDownloadURL(ref(storage, storagePath));
};

export const getStorageAssetBlob = async (storagePath: string): Promise<Blob> => {
  if (isRemoteUrl(storagePath)) {
    const response = await fetch(storagePath);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo (${response.status}).`);
    }
    return response.blob();
  }

  try {
    return await getBlob(ref(storage, storagePath));
  } catch {
    const signedUrl = await getDownloadURL(ref(storage, storagePath));
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo (${response.status}).`);
    }
    return response.blob();
  }
};

export const buildJobImageFilename = (batch: Batch, job: Job, poseIndex: number): string => [
  normalizeFilename(batch.clientNameSnapshot || 'cliente'),
  normalizeFilename(batch.modelNameSnapshot || 'modelo'),
  normalizeFilename(job.garmentName || `job-${job.id}`),
  `pose-${poseIndex + 1}`,
  `job-${job.id}.${getExtension(job.currentOutput?.resultImagePath || '')}`,
].join('_');

export const downloadSingleJobImage = async (batch: Batch, job: Job, poseIndex: number): Promise<void> => {
  if (!job.currentOutput?.resultImagePath) {
    throw new Error('Este trabajo todavía no tiene un resultado disponible.');
  }

  const blob = await getStorageAssetBlob(job.currentOutput.resultImagePath);
  saveAs(blob, buildJobImageFilename(batch, job, poseIndex));
};

export const downloadBatchImages = async (batch: Batch, jobs: Job[]) => {
  const completedJobs = jobs.filter((job) => job.currentOutput?.resultImagePath);
  if (completedJobs.length === 0) {
    throw new Error('No hay imágenes completadas para descargar.');
  }

  const zip = new JSZip();
  const zipFolderName = [
    normalizeFilename(batch.clientNameSnapshot || 'cliente'),
    normalizeFilename(batch.modelNameSnapshot || 'modelo'),
    normalizeFilename(batch.id || 'batch'),
  ].join('_');
  const folder = zip.folder(zipFolderName);

  if (!folder) {
    throw new Error('No se pudo preparar el ZIP del lote.');
  }

  for (const [index, job] of completedJobs.entries()) {
    const blob = await getStorageAssetBlob(job.currentOutput!.resultImagePath);
    folder.file(buildJobImageFilename(batch, job, index), blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  saveAs(zipBlob, `${zipFolderName}.zip`);
};
