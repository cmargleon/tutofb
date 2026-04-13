import * as admin from 'firebase-admin';
import JSZip from 'jszip';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Client,
  ImportModelBundleRequest,
  ImportModelBundleResponse,
  Model,
  ModelBundleManifest,
  ModelBundlePoseManifestEntry,
  Pose,
} from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

const bucket = admin.storage().bucket();
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

const sanitizeFileName = (fileName: string): string =>
  fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'pose.png';

const getFileExtension = (fileName: string): string => {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || 'png';
};

const inferContentType = (entry: ModelBundlePoseManifestEntry): string => {
  const declared = typeof entry.contentType === 'string' ? entry.contentType.trim() : '';
  if (declared) {
    return declared;
  }

  return CONTENT_TYPE_BY_EXTENSION[getFileExtension(entry.fileName)] || 'application/octet-stream';
};

const parseManifest = async (zip: JSZip): Promise<ModelBundleManifest> => {
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new HttpsError('failed-precondition', 'El ZIP no contiene un manifest.json válido.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await manifestFile.async('text'));
  } catch {
    throw new HttpsError('failed-precondition', 'No se pudo leer el manifest.json del ZIP.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new HttpsError('failed-precondition', 'El manifest.json del ZIP es inválido.');
  }

  const manifest = parsed as ModelBundleManifest;
  if (manifest.schemaVersion !== 1) {
    throw new HttpsError('failed-precondition', 'La versión del bundle de modelos no es compatible.');
  }

  if (!Array.isArray(manifest.poses) || manifest.poses.length === 0) {
    throw new HttpsError('failed-precondition', 'El ZIP no contiene poses para importar.');
  }

  return manifest;
};

const validateArchivePath = (archivePath: string): string => {
  const normalized = archivePath.trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || !normalized.startsWith('poses/')) {
    throw new HttpsError('failed-precondition', `La pose "${archivePath}" no tiene una ruta válida dentro del ZIP.`);
  }

  return normalized;
};

const buildImportedPose = async (
  zip: JSZip,
  storageRootPath: string,
  entry: ModelBundlePoseManifestEntry,
): Promise<{ pose: Pose; storagePath: string }> => {
  const archivePath = validateArchivePath(entry.archivePath);
  const zipFile = zip.file(archivePath);
  if (!zipFile) {
    throw new HttpsError('failed-precondition', `No encontramos la foto "${archivePath}" dentro del ZIP.`);
  }

  const poseId = typeof entry.id === 'string' && entry.id.trim()
    ? entry.id.trim()
    : globalThis.crypto.randomUUID();
  const fileName = sanitizeFileName(entry.fileName || archivePath.split('/').pop() || `${poseId}.png`);
  const storagePath = `${storageRootPath}/poses/${poseId}-${fileName}`;
  const contentType = inferContentType(entry);
  const bytes = await zipFile.async('nodebuffer');

  await bucket.file(storagePath).save(bytes, {
    resumable: false,
    metadata: {
      contentType,
    },
  });

  return {
    storagePath,
    pose: {
      id: poseId,
      storagePath,
      fileName,
      width: typeof entry.width === 'number' ? entry.width : null,
      height: typeof entry.height === 'number' ? entry.height : null,
      aiClassification: entry.aiClassification || null,
      createdAt: entry.createdAt || new Date().toISOString(),
    },
  };
};

export const importModelBundle = onCall<
  ImportModelBundleRequest,
  Promise<ImportModelBundleResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const clientId = requireNonEmptyString(request.data?.clientId, 'El cliente');
  const storagePath = requireNonEmptyString(request.data?.storagePath, 'La ruta del ZIP');
  requireNonEmptyString(request.data?.originalFileName, 'El nombre del archivo');

  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
  }

  if (!storagePath.startsWith(`model_imports/${request.auth.uid}/`)) {
    throw new HttpsError('permission-denied', 'El ZIP no está guardado en la ruta temporal esperada.');
  }

  const db = getAppFirestore();
  const clientRef = db.collection('clients').doc(clientId);
  const clientSnapshot = await clientRef.get();
  if (!clientSnapshot.exists) {
    throw new HttpsError('not-found', 'Cliente no encontrado.');
  }

  const client = { id: clientSnapshot.id, ...clientSnapshot.data() } as Client;
  if (isArchivedCatalogEntity(client)) {
    throw new HttpsError('failed-precondition', 'No puedes importar modelos en un cliente archivado.');
  }

  const tempZipFile = bucket.file(storagePath);
  const uploadedStoragePaths: string[] = [];

  try {
    const [zipBuffer] = await tempZipFile.download();
    const zip = await JSZip.loadAsync(zipBuffer);
    const manifest = await parseManifest(zip);
    const modelName = requireNonEmptyString(manifest.name, 'El nombre del modelo');
    const newModelRef = db.collection('models').doc();
    const modelId = newModelRef.id;
    const storageRootPath = `models/${clientId}/${modelId}`;
    const poses: Pose[] = [];

    for (const entry of manifest.poses) {
      const imported = await buildImportedPose(zip, storageRootPath, entry);
      uploadedStoragePaths.push(imported.storagePath);
      poses.push(imported.pose);
    }

    const coverPose = poses[0] || null;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const modelData: Omit<Model, 'id'> = {
      clientId,
      clientNameSnapshot: client.name,
      name: modelName,
      identityTraits: manifest.identityTraits || null,
      status: 'active',
      archivedAt: null,
      archivedByUid: null,
      storageRootPath,
      poses,
      poseCount: poses.length,
      coverPoseId: coverPose?.id || null,
      coverPosePath: coverPose?.storagePath || null,
      generatedPhotoCount: 0,
      generatedPhotoCostUsd: 0,
      createdAt: now,
      updatedAt: now,
      createdByUid: request.auth.uid,
    };

    await newModelRef.set(modelData);

    return {
      success: true,
      modelId,
      modelName,
      importedPoseCount: poses.length,
    };
  } catch (error) {
    await Promise.allSettled(
      uploadedStoragePaths.map((uploadedPath) => bucket.file(uploadedPath).delete({ ignoreNotFound: true })),
    );

    if (error instanceof HttpsError) {
      throw error;
    }

    console.error('Error importing model bundle:', error);
    throw new HttpsError('internal', 'No se pudo importar el ZIP del modelo.');
  } finally {
    await tempZipFile.delete({ ignoreNotFound: true }).catch(() => undefined);
  }
});
