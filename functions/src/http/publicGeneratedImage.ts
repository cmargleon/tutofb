import { getJobReviewReferencePaths, needsLegacyJobReviewReferences } from '../../../shared/src/jobReview';
import type { Job } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';
import { assertUserRoles } from '../auth/roles';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { getBearerToken } from './downloadAssets.helpers';
import * as admin from 'firebase-admin';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

const bucket = admin.storage().bucket();

const resolveStoragePath = async (request: Request, uid: string): Promise<string> => {
  const rawPath = request.path.replace(/^\/+/, '');
  const decodedPath = rawPath
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join('/');

  const parts = decodedPath.split('/');
  if (parts.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new HttpsError('invalid-argument', 'Ruta inválida.');
  }

  if (parts[0] === 'generated') {
    await assertHumanClientAccess(uid, parts[1]);
    return decodedPath;
  }

  if (parts[0] === 'review-reference') {
    const db = getAppFirestore();
    const job = (await db.collection('jobs').doc(validId(parts[1])).get()).data() as Job | undefined;
    if (!job) throw new HttpsError('not-found', 'Trabajo no encontrado.');
    await assertHumanClientAccess(uid, job.clientId);
    const path = parts.slice(2).join('/');
    if (getJobReviewReferencePaths(job).includes(path)) return path;
    if (needsLegacyJobReviewReferences(job) && job.batchId && job.garmentId) {
      const matches = await db.collection('jobs')
        .where('clientId', '==', job.clientId).where('batchId', '==', job.batchId)
        .where('garmentId', '==', job.garmentId).where('garmentFilePath', '==', path).limit(1).get();
      if (!matches.empty) return path;
    }
  }

  throw new HttpsError('permission-denied', 'Imagen fuera del alcance de este trabajo.');
};

export const publicGeneratedImage = onRequest(
  {
    timeoutSeconds: 120,
    cors: true,
  },
  async (request: Request, response: Response) => {
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.status(405).json({ message: 'Método no permitido.' });
      return;
    }

    try {
      const token = getBearerToken(request.header('Authorization'));
      if (!token) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
      const decoded = await admin.auth().verifyIdToken(token);
      await assertUserRoles(decoded.uid, decoded.role, ['admin', 'operador', 'revisor']);
      const storagePath = await resolveStoragePath(request, decoded.uid);
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();

      if (!exists) {
        throw new HttpsError('not-found', 'Imagen no encontrada.');
      }

      const [metadata] = await file.getMetadata();
      const contentType = metadata.contentType || 'application/octet-stream';
      if (request.path.startsWith('/review-reference/') && !/^image\/(jpeg|png|webp|avif|gif|bmp|tiff|heic|heif)$/i.test(contentType)) {
        throw new HttpsError('failed-precondition', 'El archivo no tiene un formato de imagen compatible.');
      }
      response.set('X-Content-Type-Options', 'nosniff');
      const cacheControl = 'private, no-store, max-age=0';

      response.set('Content-Type', contentType);
      response.set('Cache-Control', cacheControl);
      response.set('Content-Disposition', 'inline');

      if (metadata.size) {
        response.set('Content-Length', String(metadata.size));
      }

      if (request.method === 'HEAD') {
        response.status(200).end();
        return;
      }

      file.createReadStream()
        .on('error', (error) => {
          console.error(`Error streaming public generated image ${storagePath}:`, error);
          if (!response.headersSent) {
            response.status(500).json({ message: 'No se pudo servir la imagen.' });
          } else {
            response.end();
          }
        })
        .pipe(response);
    } catch (error) {
      if (error instanceof HttpsError) {
        const statusCode =
          error.code === 'unauthenticated' ? 401 : error.code === 'permission-denied'
            ? 403
            : ['invalid-argument', 'failed-precondition'].includes(error.code)
              ? 400
              : error.code === 'not-found'
                ? 404
                : 500;
        response.status(statusCode).json({ message: error.message });
        return;
      }

      console.error('Error serving public generated image:', error);
      response.status(500).json({ message: 'No se pudo servir la imagen.' });
    }
  },
);
