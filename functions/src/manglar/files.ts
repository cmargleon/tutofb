import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ManglarUploadRequest, ManglarDriveImportRequest, Model } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { signedAsset } from '../http/downloadAssets.service';
import { assertClientAccess, assertResourceAccess, assertStorageAccess, validId } from './access';
import type { DelegatedCaller } from './context';
import { importDriveImage } from '../automation/drive';
export const uploadPolicy = async (input: ManglarUploadRequest, caller: DelegatedCaller) => {
    assertClientAccess(caller, input.clientId);
    const adminOnly = ['modelPose', 'spreadsheetTemplate', 'modelBundle'].includes(input.purpose);
    if (caller.role === 'revisor' || adminOnly && caller.role !== 'admin')
        throw new HttpsError('permission-denied', 'Sin permiso para subir este archivo.');
    const fileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
    const image = ['reference', 'modelPose'].includes(input.purpose);
    const maximum = image ? 10 * 1024 * 1024 : 20 * 1024 * 1024;
    if (!fileName || !Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes >= maximum
        || !(image ? ['image/jpeg', 'image/png', 'image/webp'] : input.purpose === 'modelBundle' ? ['application/zip', 'application/x-zip-compressed'] : ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']).includes(input.contentType))
        throw new HttpsError('invalid-argument', 'Tamaño o tipo de archivo inválido.');
    const id = randomUUID();
    const path = input.purpose === 'reference' ? `garments/drafts/${caller.uid}/${id}/source/${fileName}`
        : input.purpose === 'sourceSpreadsheet' ? `wizard_source_spreadsheets/${caller.uid}/${id}/${fileName}`
            : input.purpose === 'modelBundle' ? `model_imports/${caller.uid}/${id}/${fileName}`
                : input.purpose === 'spreadsheetTemplate' ? `client_spreadsheets/${input.clientId}/${id}/${fileName}`
                    : `models/${input.clientId}/${validId(input.modelId)}/poses/${id}-${fileName}`;
    if (input.purpose === 'modelPose')
        await assertResourceAccess(caller, 'models', input.modelId);
    const [policy] = await admin.storage().bucket().file(path).generateSignedPostPolicyV4({ expires: Date.now() + 600000,
        fields: { 'Content-Type': input.contentType, 'x-goog-meta-ownerUid': caller.uid }, conditions: [['content-length-range', input.sizeBytes, input.sizeBytes]] });
    return { storagePath: path, method: 'POST', url: policy.url, fields: policy.fields, expiresInSeconds: 600,
        transferRequirement: 'Un cliente HTTP autorizado debe enviar multipart/form-data con los campos y el archivo. Esta herramienta no recibe bytes ni concede a ChatGPT acceso a archivos locales. Drive permite importación directa con files.importDrive.' };
};
export const previewFile = async (path: string, caller: DelegatedCaller) => signedAsset(await assertStorageAccess(caller, path));
export const importDriveReference = async (input: ManglarDriveImportRequest, caller: DelegatedCaller) => {
    assertClientAccess(caller, input.clientId);
    if (caller.role === 'revisor')
        throw new HttpsError('permission-denied', 'Sin permiso para importar referencias.');
    return importDriveImage(input.clientId, caller.uid, input);
};
export const discardTemporaryFile = async (path: string, caller: DelegatedCaller) => {
    await assertStorageAccess(caller, path);
    if (!(path.startsWith(`garments/drafts/${caller.uid}/`) || path.startsWith(`wizard_source_spreadsheets/${caller.uid}/`) || path.startsWith(`model_imports/${caller.uid}/`)))
        throw new HttpsError('permission-denied', 'Solo se pueden descartar archivos temporales propios.');
    // References already used by production must remain intact.
    for (const field of ['garmentFilePath', 'poseImagePath']) {
        if (!(await getAppFirestore().collection('jobs').where(field, '==', path).limit(1).get()).empty)
            throw new HttpsError('failed-precondition', 'La referencia ya está asociada a una producción.');
    }
    for (const field of ['productReferencePaths', 'automationReferencePaths']) {
        if (!(await getAppFirestore().collection('jobs').where(field, 'array-contains', path).limit(1).get()).empty)
            throw new HttpsError('failed-precondition', 'La referencia ya está asociada a una producción.');
    }
    // Historical models may still refer to drafts, including non-cover poses and
    // previews. Firestore cannot query a nested field inside an array of maps.
    // Bound this compatibility check and fail closed if the catalog is larger;
    // never delete on the assumption that an unchecked model is unreferenced.
    const maximumModels = 500;
    const models = await getAppFirestore().collection('models').select('poses', 'coverPosePath').limit(maximumModels + 1).get();
    if (models.size > maximumModels)
        throw new HttpsError('failed-precondition', 'No se puede comprobar de forma acotada si el archivo está utilizado por un modelo. Conserva el temporal.');
    if (models.docs.some((doc) => {
        const model = doc.data() as Pick<Model, 'poses' | 'coverPosePath'>;
        return model.coverPosePath === path || model.poses?.some((pose) => pose.storagePath === path || pose.previewStoragePath === path);
    }))
        throw new HttpsError('failed-precondition', 'La referencia ya está asociada a un modelo.');
    await admin.storage().bucket().file(path).delete({ ignoreNotFound: true });
    return { discarded: true };
};
export const thumbnailFile = async (path: string, caller: DelegatedCaller) => {
    await assertStorageAccess(caller, path);
    const file = admin.storage().bucket().file(path);
    const [metadata] = await file.getMetadata();
    if (!metadata.contentType?.startsWith('image/') || Number(metadata.size) > 10 * 1024 * 1024)
        throw new HttpsError('invalid-argument', 'La previsualización requiere una imagen de hasta 10 MB.');
    const sharp = (await import('sharp')).default;
    const [bytes] = await file.download();
    const thumbnail = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    return { storagePath: path, mimeType: 'image/jpeg', __mcpImage: thumbnail.toString('base64') };
};
