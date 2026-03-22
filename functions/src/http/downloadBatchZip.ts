import * as admin from 'firebase-admin';
import JSZip from 'jszip';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import { Batch, Job } from '../../../shared/src/types';
import { assertUserRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import {
  buildJobImageFilename,
  buildZipFolderName,
  getBearerToken,
  parseBody,
  readAssetBytes,
  setCorsHeaders,
} from './downloadAssets.helpers';

const db = getAppFirestore();

export const downloadBatchZip = onRequest(
  {
    timeoutSeconds: 300,
    cors: true,
  },
  async (request: Request, response: Response) => {
  setCorsHeaders(request.headers.origin, response);

  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }

  if (request.method !== 'POST') {
    response.status(405).json({ message: 'Método no permitido.' });
    return;
  }

  try {
    const token = getBearerToken(request.header('Authorization') || request.header('authorization'));
    if (!token) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión para descargar el lote.');
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    await assertUserRoles(decodedToken.uid, decodedToken.role, ['admin', 'operador', 'revisor']);

    const body = parseBody(request.body);
    const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : '';
    if (!batchId) {
      throw new HttpsError('invalid-argument', 'Debes indicar el lote que quieres descargar.');
    }

    const batchSnapshot = await db.collection('batches').doc(batchId).get();
    if (!batchSnapshot.exists) {
      throw new HttpsError('not-found', 'Lote no encontrado.');
    }

    const batch = { id: batchSnapshot.id, ...batchSnapshot.data() } as Batch;
    const jobsSnapshot = await db
      .collection('jobs')
      .where('batchId', '==', batchId)
      .orderBy('createdAt', 'asc')
      .get();

    const completedJobs = jobsSnapshot.docs
      .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }) as Job)
      .filter((job) => job.currentOutput?.resultImagePath);

    if (completedJobs.length === 0) {
      throw new HttpsError('failed-precondition', 'No hay imágenes completadas para descargar.');
    }

    const zip = new JSZip();
    const zipFolderName = buildZipFolderName(batch);
    const folder = zip.folder(zipFolderName);

    if (!folder) {
      throw new Error('No se pudo preparar el ZIP del lote.');
    }

    for (const [index, job] of completedJobs.entries()) {
      const resultImagePath = job.currentOutput?.resultImagePath;
      if (!resultImagePath) {
        continue;
      }

      const bytes = await readAssetBytes(resultImagePath);
      folder.file(buildJobImageFilename(batch, job, index), bytes);
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    response.set('Content-Type', 'application/zip');
    response.set('Content-Disposition', `attachment; filename="${zipFolderName}.zip"`);
    response.set('Cache-Control', 'private, no-store, max-age=0');
    response.status(200).send(zipBuffer);
  } catch (error) {
    if (error instanceof SyntaxError) {
      response.status(400).json({ message: 'El cuerpo de la solicitud no es JSON válido.' });
      return;
    }

    if (error instanceof HttpsError) {
      const statusCode =
        error.code === 'unauthenticated'
          ? 401
          : error.code === 'permission-denied'
            ? 403
            : error.code === 'not-found'
              ? 404
              : error.code === 'failed-precondition' || error.code === 'invalid-argument'
                ? 400
                : 500;

      response.status(statusCode).json({ message: error.message });
      return;
    }

    console.error('Error preparing batch ZIP download:', error);
    response.status(500).json({ message: 'No se pudo preparar la descarga del lote.' });
  }
});
