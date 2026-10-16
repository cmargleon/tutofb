import { isProvider } from '../../../shared/src/domain';
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { AutomationJob, AutomationStatus, CreateAutomationJobRequest, Job } from '../../../shared/src/types';

export const MAX_INTAKE_ATTEMPTS = 3;
const id = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !/^[\w. @:+-]{1,200}$/.test(value.trim())) {
    throw new HttpsError('invalid-argument', `${name} inválido.`);
  }
  return value.trim();
};
export const validateAutomationInput = (value: unknown, uid: string): CreateAutomationJobRequest => {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Payload inválido.');
  const data = value as CreateAutomationJobRequest;
  if (!['gmail', 'manual', 'api'].includes(data.source) || !['garment', 'product'].includes(data.jobType)) {
    throw new HttpsError('invalid-argument', 'source o jobType inválido.');
  }
  const result: CreateAutomationJobRequest = {
    source: data.source, jobType: data.jobType, externalId: id(data.externalId, 'externalId'),
    clientId: id(data.clientId, 'clientId'),
  };
  if (data.gmailMessageId !== undefined) result.gmailMessageId = id(data.gmailMessageId, 'gmailMessageId');
  if (data.modelId != null) result.modelId = id(data.modelId, 'modelId');
  if (data.preset != null) result.preset = id(data.preset, 'preset');
  if (data.provider != null) {
    if (!isProvider(data.provider)) throw new HttpsError('invalid-argument', 'Selecciona un modelo de fal.ai válido.');
    result.provider = data.provider;
  }
  if (data.driveUrl !== undefined) {
    let url: URL;
    try { url = new URL(data.driveUrl); } catch { throw new HttpsError('invalid-argument', 'driveUrl inválida.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password || data.driveUrl.length > 2048) {
      throw new HttpsError('invalid-argument', 'Se requiere un enlace HTTPS de drive.google.com.');
    }
    result.driveUrl = data.driveUrl;
  }
  if (data.metadata !== undefined) {
    if (!data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata) || JSON.stringify(data.metadata).length > 8000) {
      throw new HttpsError('invalid-argument', 'metadata debe ser un objeto de hasta 8 KB.');
    }
    result.metadata = data.metadata;
  }
  if (data.inputImages !== undefined && !Array.isArray(data.inputImages)) throw new HttpsError('invalid-argument', 'inputImages inválido.');
  result.inputImages = (data.inputImages || []).map((image) => {
    if (!image || typeof image !== 'object' || typeof image.fileName !== 'string' || !image.fileName.trim() || image.fileName.length > 200) {
      throw new HttpsError('invalid-argument', 'Imagen inválida.');
    }
    const entry = { itemId: id(image.itemId, 'itemId'), fileName: image.fileName } as NonNullable<CreateAutomationJobRequest['inputImages']>[number];
    if (Boolean(image.storagePath) === Boolean(image.url)) throw new HttpsError('invalid-argument', 'Usa storagePath o url por imagen.');
    if (image.storagePath) {
      if (!image.storagePath.startsWith(`garments/drafts/${uid}/`) || image.storagePath.includes('..') || image.storagePath.length > 1024) {
        throw new HttpsError('permission-denied', 'La imagen no pertenece al caller.');
      }
      entry.storagePath = image.storagePath;
    } else {
      try {
        const url = new URL(image.url!);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || image.url!.length > 2048) throw new Error();
      } catch { throw new HttpsError('invalid-argument', 'URL de imagen inválida.'); }
      entry.url = image.url;
    }
    return entry;
  });
  const counts = new Map<string, number>();
  result.inputImages.forEach((image) => counts.set(image.itemId, (counts.get(image.itemId) || 0) + 1));
  if (result.inputImages.length > 40 || [...counts.values()].some((count) => count > 4)) throw new HttpsError('invalid-argument', 'Máximo 40 fotos y 4 vistas por artículo.');
  if (!result.inputImages.length && !result.driveUrl) throw new HttpsError('invalid-argument', 'Se requieren imágenes o driveUrl.');
  return result;
};
export const automationKeys = (data: Pick<CreateAutomationJobRequest, 'externalId' | 'gmailMessageId'>): string[] => [
  `external:${data.externalId}`, ...(data.gmailMessageId ? [`gmail:${data.gmailMessageId}`] : []),
].map((key) => createHash('sha256').update(key).digest('hex'));
export const canReadAutomation = (job: Pick<AutomationJob, 'createdByUid'>, uid: string, role: string): boolean => role === 'admin' || job.createdByUid === uid;
export const summarizeAutomation = (jobs: Job[]): { status: AutomationStatus; progress: AutomationJob['progress']; outputImages: AutomationJob['outputImages'] } => {
  const completed = jobs.filter((job) => job.status === 'completed');
  const failed = jobs.filter((job) => job.status === 'failed');
  const done = jobs.length > 0 && completed.length + failed.length === jobs.length;
  return {
    status: done ? (failed.length ? 'needs_attention' : 'completed') : jobs.some((job) => job.currentOutput && job.status !== 'completed') ? 'review' : 'processing',
    progress: { total: jobs.length, completed: completed.length, failed: failed.length },
    outputImages: completed.filter((job) => job.currentOutput?.autoReview?.verdict === 'approved').map((job) => ({
      storagePath: job.currentOutput!.resultImagePath, jobId: job.id!, itemId: job.garmentId, type: job.productScene || 'garment',
    })),
  };
};
