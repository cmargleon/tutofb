import FileSaver from 'file-saver';
import { getBlob, getDownloadURL, ref } from 'firebase/storage';
import { Batch, Job } from '../../../shared/src/types';
import { auth, storage } from '../../firebase';
import firebaseConfig from '../../../firebase-applet-config.json';

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

export const buildBatchZipFilename = (batch: Batch): string =>
  [
    normalizeFilename(batch.clientNameSnapshot || 'cliente'),
    normalizeFilename(batch.modelNameSnapshot || 'modelo'),
    normalizeFilename(batch.id || 'batch'),
  ].join('_');

const getBatchZipDownloadUrl = (): string => {
  const projectId = firebaseConfig.projectId;
  if (!projectId) {
    throw new Error('No se encontró el projectId de Firebase para descargar el lote.');
  }

  if (import.meta.env?.VITE_USE_FIREBASE_EMULATORS === 'true') {
    return `http://127.0.0.1:5001/${projectId}/us-central1/downloadBatchZip`;
  }

  return `https://us-central1-${projectId}.cloudfunctions.net/downloadBatchZip`;
};

const getJobImageDownloadUrl = (): string => {
  const projectId = firebaseConfig.projectId;
  if (!projectId) {
    throw new Error('No se encontró el projectId de Firebase para descargar la imagen.');
  }

  if (import.meta.env?.VITE_USE_FIREBASE_EMULATORS === 'true') {
    return `http://127.0.0.1:5001/${projectId}/us-central1/downloadJobImage`;
  }

  return `https://us-central1-${projectId}.cloudfunctions.net/downloadJobImage`;
};

const requestBatchZipBlob = async (batchId: string): Promise<Blob> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Debes iniciar sesión para descargar las imágenes.');
  }

  const idToken = await user.getIdToken();
  let response: globalThis.Response;

  try {
    response = await fetch(getBatchZipDownloadUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batchId }),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'No se pudo conectar con la función de descarga. Si estás en localhost, reinicia o despliega Functions para aplicar el cambio de CORS.',
      );
    }

    throw error;
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    let message = `No se pudo descargar el lote (${response.status}).`;

    try {
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as { message?: string };
        if (payload.message) {
          message = payload.message;
        }
      } else {
        const text = (await response.text()).trim();
        if (text) {
          message = text;
        }
      }
    } catch {
      // Si la respuesta no se puede parsear, conservamos el mensaje por defecto.
    }

    throw new Error(message);
  }

  return response.blob();
};

const requestJobImageBlob = async (jobId: string): Promise<Blob> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Debes iniciar sesión para descargar las imágenes.');
  }

  const idToken = await user.getIdToken();
  let response: globalThis.Response;

  try {
    response = await fetch(getJobImageDownloadUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobId }),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'No se pudo conectar con la función de descarga. Si estás en localhost, reinicia o despliega Functions para aplicar el cambio de CORS.',
      );
    }

    throw error;
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    let message = `No se pudo descargar la imagen (${response.status}).`;

    try {
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as { message?: string };
        if (payload.message) {
          message = payload.message;
        }
      } else {
        const text = (await response.text()).trim();
        if (text) {
          message = text;
        }
      }
    } catch {
      // Si la respuesta no se puede parsear, conservamos el mensaje por defecto.
    }

    throw new Error(message);
  }

  return response.blob();
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
  if (!job.id) {
    throw new Error('No se encontró el identificador del trabajo a descargar.');
  }

  if (!job.currentOutput?.resultImagePath) {
    throw new Error('Este trabajo todavía no tiene un resultado disponible.');
  }

  const blob = await requestJobImageBlob(job.id);
  saveAs(blob, buildJobImageFilename(batch, job, poseIndex));
};

export const downloadBatchImages = async (batch: Batch, jobs: Job[]) => {
  const completedJobs = jobs.filter((job) => job.currentOutput?.resultImagePath);
  if (completedJobs.length === 0) {
    throw new Error('No hay imágenes completadas para descargar.');
  }

  if (!batch.id) {
    throw new Error('No se encontró el identificador del lote a descargar.');
  }

  const zipBlob = await requestBatchZipBlob(batch.id);
  saveAs(zipBlob, `${buildBatchZipFilename(batch)}.zip`);
};
