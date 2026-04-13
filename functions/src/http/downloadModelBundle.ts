import * as admin from 'firebase-admin';
import JSZip from 'jszip';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import {
  Model,
  ModelBundleManifest,
  ModelBundlePoseManifestEntry,
} from '../../../shared/src/types';
import { assertUserRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import {
  getBearerToken,
  normalizeFilename,
  parseBody,
  setCorsHeaders,
} from './downloadAssets.helpers';

const db = getAppFirestore();
const bucket = admin.storage().bucket();

const getExtensionFromPath = (value: string): string => {
  const match = value.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() || 'png';
};

const sanitizeArchiveFileName = (fileName: string, fallbackPath: string, index: number): string => {
  const normalized = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '');
  if (normalized) {
    return normalized;
  }

  return `pose-${index + 1}.${getExtensionFromPath(fallbackPath)}`;
};

const readPoseAsset = async (storagePath: string): Promise<{ bytes: Buffer; contentType: string }> => {
  const file = bucket.file(storagePath);
  const [[metadata], [bytes]] = await Promise.all([
    file.getMetadata(),
    file.download(),
  ]);

  return {
    bytes,
    contentType: metadata.contentType || 'application/octet-stream',
  };
};

const buildBundleFilename = (model: Model): string =>
  [
    normalizeFilename(model.clientNameSnapshot || 'cliente'),
    normalizeFilename(model.name || 'modelo'),
    normalizeFilename(model.id || 'model'),
  ].join('_');

export const downloadModelBundle = onRequest(
  {
    timeoutSeconds: 300,
    memory: '1GiB',
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
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión para exportar el modelo.');
      }

      const decodedToken = await admin.auth().verifyIdToken(token);
      await assertUserRoles(decodedToken.uid, decodedToken.role, ['admin']);

      const body = parseBody(request.body);
      const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
      if (!modelId) {
        throw new HttpsError('invalid-argument', 'Debes indicar el modelo que quieres exportar.');
      }

      const modelSnapshot = await db.collection('models').doc(modelId).get();
      if (!modelSnapshot.exists) {
        throw new HttpsError('not-found', 'Modelo no encontrado.');
      }

      const model = { id: modelSnapshot.id, ...modelSnapshot.data() } as Model;
      if (!Array.isArray(model.poses) || model.poses.length === 0) {
        throw new HttpsError('failed-precondition', 'El modelo no tiene fotos para exportar.');
      }

      const zip = new JSZip();
      const manifestPoses: ModelBundlePoseManifestEntry[] = [];

      for (const [index, pose] of model.poses.entries()) {
        const archiveFileName = sanitizeArchiveFileName(pose.fileName, pose.storagePath, index);
        const archivePath = `poses/${String(index + 1).padStart(3, '0')}-${archiveFileName}`;
        const asset = await readPoseAsset(pose.storagePath);

        zip.file(archivePath, asset.bytes);
        manifestPoses.push({
          id: pose.id,
          archivePath,
          fileName: pose.fileName,
          contentType: asset.contentType,
          width: pose.width ?? null,
          height: pose.height ?? null,
          aiClassification: pose.aiClassification ?? null,
          createdAt: pose.createdAt,
        });
      }

      const manifest: ModelBundleManifest = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        sourceModelId: model.id!,
        sourceClientId: model.clientId,
        sourceClientName: model.clientNameSnapshot,
        name: model.name,
        identityTraits: model.identityTraits || null,
        status: model.status,
        generatedPhotoCount: model.generatedPhotoCount || 0,
        generatedPhotoCostUsd: Number(model.generatedPhotoCostUsd || 0),
        poses: manifestPoses,
      };

      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      const filename = `${buildBundleFilename(model)}.zip`;
      const tempPath = `temp/model_exports/${model.id}-${crypto.randomUUID()}.zip`;
      const tempFile = bucket.file(tempPath);

      await tempFile.save(zipBuffer, {
        metadata: { contentType: 'application/zip' },
      });

      const [signedUrl] = await tempFile.getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000, // 15 min
        version: 'v4',
      });

      response.status(200).json({ downloadUrl: signedUrl, filename });
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

      console.error('Error preparing model bundle ZIP:', error);
      response.status(500).json({ message: 'No se pudo preparar la descarga del modelo.' });
    }
  },
);
