import * as admin from 'firebase-admin';
import JSZip from 'jszip';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
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
const MAX_SELECTED_JOBS = 100;

export const downloadSelectedJobsZip = onRequest(
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
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión para descargar la selección.');
      }

      const decodedToken = await admin.auth().verifyIdToken(token);
      await assertUserRoles(decodedToken.uid, decodedToken.role, ['admin', 'operador', 'revisor']);

      const body = parseBody(request.body);
      const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : '';
      const jobIds = Array.isArray(body.jobIds)
        ? body.jobIds
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
      const selectedOutputIdsByJobId =
        body.selectedOutputIdsByJobId && typeof body.selectedOutputIdsByJobId === 'object'
          ? body.selectedOutputIdsByJobId as Record<string, unknown>
          : {};

      if (!batchId || jobIds.length === 0) {
        throw new HttpsError('invalid-argument', 'Debes indicar el lote y al menos un job para descargar.');
      }

      if (jobIds.length > MAX_SELECTED_JOBS) {
        throw new HttpsError('invalid-argument', `Solo puedes descargar hasta ${MAX_SELECTED_JOBS} jobs por ZIP.`);
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

      const selectedIds = new Set(jobIds);
      const orderedSelectedJobs = jobsSnapshot.docs
        .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }) as Job)
        .filter((job) => selectedIds.has(job.id!) && resolveApprovedJobOutput(job)?.resultImagePath);

      if (orderedSelectedJobs.length === 0) {
        throw new HttpsError('failed-precondition', 'Los jobs seleccionados no tienen imágenes listas para descargar.');
      }

      const poseIndexes = Object.fromEntries(
        jobsSnapshot.docs.map((snapshot, index) => [snapshot.id, index]),
      ) as Record<string, number>;

      const zip = new JSZip();
      const zipFolderName = `${buildZipFolderName(batch)}_seleccion`;
      const folder = zip.folder(zipFolderName);

      if (!folder) {
        throw new Error('No se pudo preparar el ZIP de la selección.');
      }

      for (const job of orderedSelectedJobs) {
        const requestedOutputId = typeof selectedOutputIdsByJobId[job.id || ''] === 'string'
          ? String(selectedOutputIdsByJobId[job.id || '']).trim()
          : '';
        const selectedOutputSnapshot = requestedOutputId
          ? db.collection('jobs').doc(job.id!).collection('outputs').doc(requestedOutputId).get()
          : null;
        const resolvedSelectedOutputSnapshot = selectedOutputSnapshot ? await selectedOutputSnapshot : null;
        const selectedOutput = resolvedSelectedOutputSnapshot?.exists
          ? ({ id: resolvedSelectedOutputSnapshot.id, ...resolvedSelectedOutputSnapshot.data() } as Job['currentOutput'])
          : null;
        const resultImagePath = (selectedOutput || resolveApprovedJobOutput(job))?.resultImagePath;
        if (!resultImagePath) {
          continue;
        }

        const bytes = await readAssetBytes(resultImagePath);
        folder.file(buildJobImageFilename(batch, job, poseIndexes[job.id!] ?? 0), bytes);
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

      console.error('Error preparing selected jobs ZIP:', error);
      response.status(500).json({ message: 'No se pudo preparar la descarga de la selección.' });
    }
  },
);
