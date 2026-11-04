import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Batch, Job, JobOutput, ManglarImageRequest, ManglarZipRequest } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { getAppFirestore } from '../firebase/appFirestore';
import { buildJobImageFilename, buildZipFolderName, readAssetBytes } from './downloadAssets.helpers';
const validId = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[\w-]{1,200}$/.test(value))
        throw new HttpsError('invalid-argument', 'Identificador inválido.');
    return value;
};
export const signedAsset = async (path: string, fileName?: string) => {
    const [url] = await admin.storage().bucket().file(path).getSignedUrl({ action: 'read', version: 'v4', expires: Date.now() + 900000,
        ...(fileName ? { responseDisposition: `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"` } : {}) });
    return { storagePath: path, url, expiresInSeconds: 900, ...(fileName ? { fileName } : {}) };
};
export const resolveJobAsset = async (input: ManglarImageRequest) => {
    const snapshot = await getAppFirestore().collection('jobs').doc(validId(input.jobId)).get();
    if (!snapshot.exists)
        throw new HttpsError('not-found', 'Trabajo no encontrado.');
    const job = { ...snapshot.data(), id: snapshot.id } as Job;
    const outputSnapshot = input.outputId ? await snapshot.ref.collection('outputs').doc(validId(input.outputId)).get() : null;
    if (input.outputId && !outputSnapshot?.exists)
        throw new HttpsError('not-found', 'La salida seleccionada no existe para este job.');
    const output = outputSnapshot?.exists ? { ...outputSnapshot.data(), id: outputSnapshot.id } as JobOutput : resolveApprovedJobOutput(job);
    if (!output?.resultImagePath)
        throw new HttpsError('failed-precondition', 'No hay un resultado disponible.');
    return { job, output };
};
export const createBatchArchive = async (input: ManglarZipRequest, limits?: {
    maxFiles: number;
    maxBytes: number;
    strictOutputs?: boolean;
}) => {
    const db = getAppFirestore();
    const batchSnapshot = await db.collection('batches').doc(validId(input.batchId)).get();
    if (!batchSnapshot.exists)
        throw new HttpsError('not-found', 'Lote no encontrado.');
    if (input.jobIds && (!input.jobIds.length || input.jobIds.length > 100))
        throw new HttpsError('invalid-argument', 'Selecciona de 1 a 100 jobs.');
    const batch = { ...batchSnapshot.data(), id: batchSnapshot.id } as Batch;
    const snapshots = await db.collection('jobs').where('batchId', '==', input.batchId).orderBy('createdAt', 'asc').get();
    const jobs = snapshots.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Job));
    const zip = new JSZip();
    const filename = `${buildZipFolderName(batch)}${input.jobIds ? '_seleccion' : ''}.zip`;
    let bytesTotal = 0;
    let count = 0;
    for (const [index, job] of jobs.entries()) {
        if (input.jobIds && !input.jobIds.includes(job.id!))
            continue;
        if (!resolveApprovedJobOutput(job)?.resultImagePath)
            continue;
        const selected = input.selectedOutputIdsByJobId?.[job.id!];
        const { output } = await resolveJobAsset({ jobId: job.id!, outputId: selected }).catch(error => { if (selected && !limits?.strictOutputs && error instanceof HttpsError && error.code === 'not-found')
            return resolveJobAsset({ jobId: job.id! }); throw error; });
        const [metadata] = await admin.storage().bucket().file(output.resultImagePath).getMetadata();
        bytesTotal += Number(metadata.size || 0);
        if (limits && (bytesTotal > limits.maxBytes || count >= limits.maxFiles))
            throw new HttpsError('resource-exhausted', 'Usa selecciones de hasta 100 imágenes y 64 MB.');
        zip.file(`${filename.slice(0, -4)}/${buildJobImageFilename(batch, job, index)}`, await readAssetBytes(output.resultImagePath));
        count++;
    }
    if (!count)
        throw new HttpsError('failed-precondition', 'No hay imágenes listas para descargar.');
    return { bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }), filename };
};
export const saveTemporaryArchive = async (bytes: Buffer, fileName: string) => {
    const path = `temp/model_exports/${randomUUID()}.zip`;
    await admin.storage().bucket().file(path).save(bytes, { resumable: false, metadata: { contentType: 'application/zip' } });
    return signedAsset(path, fileName);
};
