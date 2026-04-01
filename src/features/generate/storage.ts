import { auth, storage } from '../../firebase';
import { deleteObject, ref, uploadBytesResumable } from 'firebase/storage';
import { GarmentOriginalPhotoDraft, GarmentUploadStatus, UploadedGarmentDraft } from './types';

const DEFAULT_UPLOAD_CONCURRENCY = 4;
const DEFAULT_MAX_RETRIES = 2;
const MAX_IMAGE_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_DIMENSION = 2_200;
const MIN_IMAGE_UPLOAD_DIMENSION = 900;
const MIN_UPLOAD_STALL_TIMEOUT_MS = 45_000;
const MAX_UPLOAD_STALL_TIMEOUT_MS = 3 * 60 * 1000;
const UPLOAD_TIMEOUT_PER_MB_MS = 15_000;
const RETRY_BACKOFF_MS = 1_200;
const JPEG_QUALITY_STEPS = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5] as const;
const DIMENSION_SCALE_STEPS = [1, 0.9, 0.8, 0.7, 0.6] as const;

interface UploadAttemptResult {
  storagePath: string;
  attempts: number;
  photoUploads: Array<{
    photoId: string;
    storagePath: string;
  }>;
}

class UploadFailureError extends Error {
  attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = 'UploadFailureError';
    this.attempts = attempts;
  }
}

export interface UploadGarmentProgressEvent {
  garmentId: string;
  status: GarmentUploadStatus;
  progress: number;
  attempts: number;
  error: string | null;
  storagePath: string | null;
}

interface UploadGarmentDraftsOptions {
  concurrency?: number;
  maxRetries?: number;
  onProgress?: (event: UploadGarmentProgressEvent) => void;
}

export interface UploadGarmentDraftsResult {
  uploaded: Array<{
    garmentId: string;
    storagePath: string;
    photoUploads: Array<{
      photoId: string;
      storagePath: string;
    }>;
    attempts: number;
  }>;
  failed: Array<{
    garmentId: string;
    error: string;
    attempts: number;
  }>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

const sanitizeFileName = (fileName: string): string => fileName.replace(/[^a-zA-Z0-9.-]/g, '_');

const replaceFileExtension = (fileName: string, nextExtension: string): string => {
  const sanitizedExtension = nextExtension.replace(/^\.+/, '') || 'jpg';
  return `${fileName.replace(/\.[^.]+$/, '')}.${sanitizedExtension}`;
};

const compressionCache = new WeakMap<File, Promise<File>>();

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`No se pudo preparar ${file.name} para comprimir.`));
    };

    image.src = objectUrl;
  });

const toBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('No se pudo generar la imagen comprimida.'));
        return;
      }

      resolve(blob);
    }, mimeType, quality);
  });

const resolveCompressedMimeType = (file: File): { mimeType: string; extension: string } => {
  if (file.type === 'image/webp') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  return { mimeType: 'image/jpeg', extension: 'jpg' };
};

const compressImageIfNeeded = async (file: File): Promise<File> => {
  if (file.size <= MAX_IMAGE_UPLOAD_BYTES) {
    return file;
  }

  if (!file.type.startsWith('image/')) {
    return file;
  }

  const image = await loadImage(file);
  const { mimeType, extension } = resolveCompressedMimeType(file);
  let bestCandidate: File | null = null;
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);

  for (const dimensionScale of DIMENSION_SCALE_STEPS) {
    const targetLongestSide = Math.min(
      longestSide,
      Math.max(MIN_IMAGE_UPLOAD_DIMENSION, Math.round(MAX_IMAGE_UPLOAD_DIMENSION * dimensionScale)),
    );
    const combinedScale = Math.min(1, targetLongestSide / longestSide);
    const targetWidth = Math.max(1, Math.round(image.naturalWidth * combinedScale));
    const targetHeight = Math.max(1, Math.round(image.naturalHeight * combinedScale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas no disponible para comprimir imágenes.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of JPEG_QUALITY_STEPS) {
      const blob = await toBlob(canvas, mimeType, quality);
      const candidate = new File(
        [blob],
        replaceFileExtension(file.name, extension),
        { type: mimeType, lastModified: file.lastModified },
      );

      if (!bestCandidate || candidate.size < bestCandidate.size) {
        bestCandidate = candidate;
      }

      if (candidate.size <= MAX_IMAGE_UPLOAD_BYTES) {
        return candidate;
      }
    }
  }

  if (bestCandidate && bestCandidate.size < file.size) {
    return bestCandidate;
  }

  throw new Error(`No pudimos comprimir ${file.name} por debajo de 3 MB.`);
};

const getUploadFile = (file: File): Promise<File> => {
  const cached = compressionCache.get(file);
  if (cached) {
    return cached;
  }

  const prepared = compressImageIfNeeded(file);
  compressionCache.set(file, prepared);
  return prepared;
};

const getStoragePath = (
  draftBatchId: string,
  garment: UploadedGarmentDraft,
  photo: GarmentOriginalPhotoDraft,
  uploadFileName: string = photo.fileName,
): string => {
  if (!auth.currentUser) {
    throw new Error('Usuario no autenticado');
  }

  return `garments/drafts/${auth.currentUser.uid}/${draftBatchId}/${garment.id}/${photo.id}-${sanitizeFileName(uploadFileName)}`;
};

const resolveUploadTimeoutMs = (fileSizeBytes: number): number => {
  const fileSizeMb = Math.max(1, Math.ceil(fileSizeBytes / (1024 * 1024)));
  return Math.min(
    MAX_UPLOAD_STALL_TIMEOUT_MS,
    Math.max(MIN_UPLOAD_STALL_TIMEOUT_MS, fileSizeMb * UPLOAD_TIMEOUT_PER_MB_MS),
  );
};

const isRetryableUploadError = (error: unknown): boolean => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  return !['storage/unauthorized', 'storage/unauthenticated', 'storage/invalid-argument'].includes(code);
};

const toUploadErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'No se pudo subir la prenda. Intenta de nuevo.';
};

const emitProgress = (
  onProgress: UploadGarmentDraftsOptions['onProgress'],
  event: UploadGarmentProgressEvent,
) => {
  onProgress?.(event);
};

const uploadSinglePhoto = async ({
  draftBatchId,
  garment,
  photo,
  attempt,
  completedPhotos,
  totalPhotos,
  onProgress,
}: {
  draftBatchId: string;
  garment: UploadedGarmentDraft;
  photo: GarmentOriginalPhotoDraft;
  attempt: number;
  completedPhotos: number;
  totalPhotos: number;
  onProgress?: UploadGarmentDraftsOptions['onProgress'];
}): Promise<string> => {
  const uploadFile = await getUploadFile(photo.file);
  const storagePath = getStoragePath(draftBatchId, garment, photo, uploadFile.name);
  const storageRef = ref(storage, storagePath);
  const uploadTask = uploadBytesResumable(storageRef, uploadFile, {
    contentType: uploadFile.type || 'image/jpeg',
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutMs = resolveUploadTimeoutMs(uploadFile.size);
    let timeoutId = globalThis.setTimeout(() => {
      settled = true;
      uploadTask.cancel();
      reject(new Error('La subida se quedó sin progreso. Reintentaremos automáticamente.'));
    }, timeoutMs);

    const refreshTimeout = () => {
      globalThis.clearTimeout(timeoutId);
      timeoutId = globalThis.setTimeout(() => {
        settled = true;
        uploadTask.cancel();
        reject(new Error('La subida se quedó sin progreso. Reintentaremos automáticamente.'));
      }, timeoutMs);
    };

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (settled) {
          return;
        }

        refreshTimeout();
        const photoProgress = snapshot.totalBytes > 0 ? snapshot.bytesTransferred / snapshot.totalBytes : 0;
        emitProgress(onProgress, {
          garmentId: garment.id,
          status: attempt === 1 ? 'uploading' : 'retrying',
          progress: ((completedPhotos + photoProgress) / totalPhotos) * 100,
          attempts: attempt,
          error: null,
          storagePath: null,
        });
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        if (settled && (error as { code?: string }).code === 'storage/canceled') {
          return;
        }
        settled = true;
        reject(error);
      },
      () => {
        globalThis.clearTimeout(timeoutId);
        if (settled) {
          return;
        }
        settled = true;
        emitProgress(onProgress, {
          garmentId: garment.id,
          status: attempt === 1 ? 'uploading' : 'retrying',
          progress: ((completedPhotos + 1) / totalPhotos) * 100,
          attempts: attempt,
          error: null,
          storagePath: null,
        });
        resolve();
      },
    );
  });

  return storagePath;
};

export const uploadGarmentDraft = async (
  draftBatchId: string,
  garment: UploadedGarmentDraft,
): Promise<string> => {
  const result = await uploadGarmentDrafts(draftBatchId, [garment], {
    concurrency: 1,
  });

  if (result.failed.length > 0) {
    throw new Error(result.failed[0].error);
  }

  return result.uploaded[0].storagePath;
};

const uploadGarmentDraftAttempt = async (
  draftBatchId: string,
  garment: UploadedGarmentDraft,
  attempt: number,
  onProgress?: UploadGarmentDraftsOptions['onProgress'],
): Promise<UploadAttemptResult> => {
  emitProgress(onProgress, {
    garmentId: garment.id,
    status: attempt === 1 ? 'uploading' : 'retrying',
    progress: 0,
    attempts: attempt,
    error: null,
    storagePath: null,
  });

  const uploadedPhotoPaths: UploadAttemptResult['photoUploads'] = [];

  try {
    for (let index = 0; index < garment.originalPhotos.length; index += 1) {
      const photo = garment.originalPhotos[index];
      const storagePath = await uploadSinglePhoto({
        draftBatchId,
        garment,
        photo,
        attempt,
        completedPhotos: index,
        totalPhotos: garment.originalPhotos.length,
        onProgress,
      });

      uploadedPhotoPaths.push({
        photoId: photo.id,
        storagePath,
      });
    }
  } catch (error) {
    await Promise.allSettled(
      uploadedPhotoPaths.map((entry) => deleteObject(ref(storage, entry.storagePath))),
    );
    throw error;
  }

  const primaryStoragePath = uploadedPhotoPaths[0]?.storagePath || null;
  emitProgress(onProgress, {
    garmentId: garment.id,
    status: 'uploaded',
    progress: 100,
    attempts: attempt,
    error: null,
    storagePath: primaryStoragePath,
  });

  return {
    storagePath: primaryStoragePath || '',
    photoUploads: uploadedPhotoPaths,
    attempts: attempt,
  };
};

const uploadGarmentWithRetry = async (
  draftBatchId: string,
  garment: UploadedGarmentDraft,
  maxRetries: number,
  onProgress?: UploadGarmentDraftsOptions['onProgress'],
): Promise<UploadAttemptResult> => {
  let attempt = 1;
  let lastError: unknown = null;

  while (attempt <= maxRetries + 1) {
    try {
      return await uploadGarmentDraftAttempt(draftBatchId, garment, attempt, onProgress);
    } catch (error) {
      lastError = error;
      const message = toUploadErrorMessage(error);

      if (attempt > maxRetries || !isRetryableUploadError(error)) {
        emitProgress(onProgress, {
          garmentId: garment.id,
          status: 'failed',
          progress: garment.upload.progress,
          attempts: attempt,
          error: message,
          storagePath: null,
        });
        throw new UploadFailureError(message, attempt);
      }

      emitProgress(onProgress, {
        garmentId: garment.id,
        status: 'retrying',
        progress: garment.upload.progress,
        attempts: attempt,
        error: `Reintentando (${attempt}/${maxRetries + 1})...`,
        storagePath: null,
      });
      await sleep(RETRY_BACKOFF_MS * attempt);
      attempt += 1;
    }
  }

  throw new UploadFailureError(toUploadErrorMessage(lastError), attempt);
};

export const uploadGarmentDrafts = async (
  draftBatchId: string,
  garments: UploadedGarmentDraft[],
  options: UploadGarmentDraftsOptions = {},
): Promise<UploadGarmentDraftsResult> => {
  if (!auth.currentUser) {
    throw new Error('Usuario no autenticado');
  }

  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY, 5));
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const uploaded: UploadGarmentDraftsResult['uploaded'] = [];
  const failed: UploadGarmentDraftsResult['failed'] = [];
  let nextIndex = 0;

  garments.forEach((garment) => {
    emitProgress(options.onProgress, {
      garmentId: garment.id,
      status: 'queued',
      progress: 0,
      attempts: garment.upload.attempts,
      error: null,
      storagePath: null,
    });
  });

  const worker = async () => {
    while (nextIndex < garments.length) {
      const garment = garments[nextIndex];
      nextIndex += 1;

      try {
        const result = await uploadGarmentWithRetry(draftBatchId, garment, maxRetries, options.onProgress);
        uploaded.push({
          garmentId: garment.id,
          storagePath: result.storagePath,
          photoUploads: result.photoUploads,
          attempts: result.attempts,
        });
      } catch (error) {
        const attempts = error instanceof UploadFailureError ? error.attempts : maxRetries + 1;
        failed.push({
          garmentId: garment.id,
          error: toUploadErrorMessage(error),
          attempts,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, garments.length) }, () => worker()));

  return { uploaded, failed };
};

export const deleteGarmentDraftByStoragePath = async (storagePath: string | null | undefined) => {
  if (!auth.currentUser || !storagePath) return;

  try {
    await deleteObject(ref(storage, storagePath));
  } catch (error) {
    console.error('Failed to delete draft garment', error);
  }
};

export const deleteGarmentDrafts = async (
  draftBatchId: string,
  garments: UploadedGarmentDraft[],
) => {
  if (!auth.currentUser) return;

  for (const garment of garments) {
    const storagePaths = garment.originalPhotos
      .map((photo) => photo.upload.storagePath)
      .filter((value): value is string => Boolean(value));

    if (storagePaths.length === 0) {
      const fallbackPhoto = garment.originalPhotos[0];
      if (fallbackPhoto) {
        storagePaths.push(getStoragePath(draftBatchId, garment, fallbackPhoto));
      }
    }

    await Promise.allSettled(storagePaths.map((storagePath) => deleteGarmentDraftByStoragePath(storagePath)));
  }
};
