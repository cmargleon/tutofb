import { auth, storage } from '../../firebase';
import { deleteObject, ref, uploadBytesResumable } from 'firebase/storage';
import { GarmentOriginalPhotoDraft, GarmentUploadStatus, UploadedGarmentDraft } from './types';

const DEFAULT_UPLOAD_CONCURRENCY = 4;
const DEFAULT_MAX_RETRIES = 2;
const MIN_UPLOAD_STALL_TIMEOUT_MS = 45_000;
const MAX_UPLOAD_STALL_TIMEOUT_MS = 3 * 60 * 1000;
const UPLOAD_TIMEOUT_PER_MB_MS = 15_000;
const RETRY_BACKOFF_MS = 1_200;

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

const getStoragePath = (
  draftBatchId: string,
  garment: UploadedGarmentDraft,
  photo: GarmentOriginalPhotoDraft,
): string => {
  if (!auth.currentUser) {
    throw new Error('Usuario no autenticado');
  }

  return `garments/drafts/${auth.currentUser.uid}/${draftBatchId}/${garment.id}/${photo.id}-${sanitizeFileName(photo.fileName)}`;
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
  const storagePath = getStoragePath(draftBatchId, garment, photo);
  const storageRef = ref(storage, storagePath);
  const uploadTask = uploadBytesResumable(storageRef, photo.file, {
    contentType: photo.file.type || 'image/jpeg',
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutMs = resolveUploadTimeoutMs(photo.file.size);
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
