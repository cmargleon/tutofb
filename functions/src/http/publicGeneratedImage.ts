import * as admin from 'firebase-admin';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

const bucket = admin.storage().bucket();

const resolveStoragePath = (request: Request): string => {
  const rawPath = request.path.replace(/^\/+/, '');
  const decodedPath = rawPath
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join('/');

  if (!decodedPath.startsWith('generated/')) {
    throw new HttpsError('permission-denied', 'Solo se permiten assets generados.');
  }

  if (decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new HttpsError('invalid-argument', 'Ruta inválida.');
  }

  return decodedPath;
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
      const storagePath = resolveStoragePath(request);
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();

      if (!exists) {
        throw new HttpsError('not-found', 'Imagen no encontrada.');
      }

      const [metadata] = await file.getMetadata();
      const contentType = metadata.contentType || 'application/octet-stream';
      const cacheControl = metadata.cacheControl || 'public, max-age=31536000, immutable';

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
          error.code === 'permission-denied'
            ? 403
            : error.code === 'invalid-argument'
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
