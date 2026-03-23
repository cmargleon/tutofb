import * as admin from 'firebase-admin';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { Batch, Job } from '../../../shared/src/types';
import { assertUserRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import {
  buildJobImageFilename,
  getBearerToken,
  parseBody,
  readAssetBytes,
  setCorsHeaders,
} from './downloadAssets.helpers';

const db = getAppFirestore();

export const downloadJobImage = onRequest(
  {
    timeoutSeconds: 120,
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
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión para descargar la imagen.');
      }

      const decodedToken = await admin.auth().verifyIdToken(token);
      await assertUserRoles(decodedToken.uid, decodedToken.role, ['admin', 'operador', 'revisor']);

      const body = parseBody(request.body);
      const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
      const requestedOutputId = typeof body.outputId === 'string' ? body.outputId.trim() : '';
      if (!jobId) {
        throw new HttpsError('invalid-argument', 'Debes indicar la imagen que quieres descargar.');
      }

      const jobRef = db.collection('jobs').doc(jobId);
      const jobSnapshot = await jobRef.get();
      if (!jobSnapshot.exists) {
        throw new HttpsError('not-found', 'Trabajo no encontrado.');
      }

      const job = { id: jobSnapshot.id, ...jobSnapshot.data() } as Job;
      const selectedOutputSnapshot = requestedOutputId
        ? await jobRef.collection('outputs').doc(requestedOutputId).get()
        : null;
      const selectedOutput = selectedOutputSnapshot?.exists
        ? ({ id: selectedOutputSnapshot.id, ...selectedOutputSnapshot.data() } as Job['currentOutput'])
        : null;
      if (requestedOutputId && !selectedOutput) {
        throw new HttpsError('not-found', 'La salida seleccionada ya no existe para este job.');
      }
      const resolvedOutput = selectedOutput || resolveApprovedJobOutput(job);
      const resultImagePath = resolvedOutput?.resultImagePath;
      if (!resultImagePath) {
        throw new HttpsError('failed-precondition', 'Este trabajo todavía no tiene un resultado disponible.');
      }

      const batchSnapshot = await db.collection('batches').doc(job.batchId).get();
      if (!batchSnapshot.exists) {
        throw new HttpsError('not-found', 'No se encontró el lote asociado a la imagen.');
      }

      const batch = { id: batchSnapshot.id, ...batchSnapshot.data() } as Batch;
      const jobsSnapshot = await db
        .collection('jobs')
        .where('batchId', '==', job.batchId)
        .orderBy('createdAt', 'asc')
        .get();

      const orderedJobs = jobsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }) as Job);
      const poseIndex = Math.max(
        0,
        orderedJobs.findIndex((candidate) => candidate.id === job.id),
      );
      const fileBytes = await readAssetBytes(resultImagePath);
      const fileName = buildJobImageFilename(batch, job, poseIndex);
      const contentType = resolvedOutput?.contentType || 'image/png';

      response.set('Content-Type', contentType);
      response.set('Content-Disposition', `attachment; filename="${fileName}"`);
      response.set('Cache-Control', 'private, no-store, max-age=0');
      response.status(200).send(fileBytes);
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

      console.error('Error preparing job image download:', error);
      response.status(500).json({ message: 'No se pudo preparar la descarga de la imagen.' });
    }
  },
);
