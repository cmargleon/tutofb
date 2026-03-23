import * as admin from 'firebase-admin';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { Batch, Job } from '../../../shared/src/types';

const bucket = admin.storage().bucket();

export const normalizeFilename = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'archivo';

export const isRemoteUrl = (value: string): boolean => value.startsWith('http://') || value.startsWith('https://');

export const getExtension = (value: string): string => {
  const match = value.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() || 'png';
};

export const buildJobImageFilename = (batch: Batch, job: Job, poseIndex: number): string =>
  [
    normalizeFilename(batch.clientNameSnapshot || 'cliente'),
    normalizeFilename(batch.modelNameSnapshot || 'modelo'),
    normalizeFilename(job.garmentName || `job-${job.id}`),
    `pose-${poseIndex + 1}`,
    `job-${job.id}.${getExtension(resolveApprovedJobOutput(job)?.resultImagePath || '')}`,
  ].join('_');

export const buildZipFolderName = (batch: Batch): string =>
  [
    normalizeFilename(batch.clientNameSnapshot || 'cliente'),
    normalizeFilename(batch.modelNameSnapshot || 'modelo'),
    normalizeFilename(batch.id || 'batch'),
  ].join('_');

export const setCorsHeaders = (origin: string | undefined, response: { set: (name: string, value: string) => void }) => {
  response.set('Access-Control-Allow-Origin', origin || '*');
  response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.set('Vary', 'Origin');
};

export const getBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token || null;
};

export const parseBody = (body: unknown): Record<string, unknown> => {
  if (typeof body === 'string') {
    return JSON.parse(body) as Record<string, unknown>;
  }

  if (body && typeof body === 'object') {
    return body as Record<string, unknown>;
  }

  return {};
};

export const readAssetBytes = async (storagePath: string): Promise<Buffer> => {
  if (isRemoteUrl(storagePath)) {
    const response = await fetch(storagePath);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo remoto (${response.status}).`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  const [buffer] = await bucket.file(storagePath).download();
  return buffer;
};
