import * as admin from 'firebase-admin';
import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { BlockList } from 'node:net';
import sharp from 'sharp';
import { defineString } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';
import { AutomationInput, AutomationJob } from '../../../shared/src/types';

const IMPORT_HOSTS = defineString('AUTOMATION_IMPORT_HOSTS', { default: 'disabled' });
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export class AutomationAttentionError extends Error {}
export interface DriveImportAdapter {
  importImages(driveUrl: string, job: AutomationJob): Promise<AutomationInput[]>;
}
export const pendingDriveAdapter: DriveImportAdapter = {
  async importImages() {
    throw new AutomationAttentionError('Drive requiere un adapter con acceso autorizado a la carpeta. Sube los archivos mediante el intake y reintenta.');
  },
};
const blocked = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) blocked.addSubnet(network, prefix, 'ipv4');
export const assertImportUrl = (raw: string, hosts: string[]): URL => {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.includes(url.hostname)) {
    throw new AutomationAttentionError('El host de importación no está autorizado en AUTOMATION_IMPORT_HOSTS.');
  }
  return url;
};
const downloadUrl = async (raw: string): Promise<Buffer> => {
  const url = assertImportUrl(raw, IMPORT_HOSTS.value().split(',').map((host) => host.trim()).filter((host) => Boolean(host) && host !== 'disabled'));
  const { address } = await lookup(url.hostname, { family: 4 });
  if (blocked.check(address, 'ipv4')) throw new HttpsError('invalid-argument', 'Dirección de importación privada o reservada.');
  return new Promise((resolve, reject) => {
    const request = get(url, { family: 4, lookup: (_hostname, _options, callback) => callback(null, address, 4) }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('La descarga de imagen falló.')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size >= MAX_INPUT_BYTES) { request.destroy(new Error('Imagen demasiado grande.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(new Error('La descarga excedió 30 segundos.')), 30_000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
};
export const normalizeInputImage = async (bytes: Buffer): Promise<Buffer> => {
  if (!bytes.length || bytes.length >= MAX_INPUT_BYTES) throw new HttpsError('invalid-argument', 'Imagen vacía o de más de 10 MB.');
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw new HttpsError('invalid-argument', 'Usa una fotografía JPEG, PNG o WebP.');
  try {
    return await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 94 }).toBuffer();
  } catch { throw new HttpsError('invalid-argument', 'Archivo de imagen no compatible.'); }
};
export const importImagesForAutomationJob = async (job: AutomationJob, drive: DriveImportAdapter = pendingDriveAdapter): Promise<AutomationInput[]> => {
  const bucket = admin.storage().bucket();
  const inputs = job.inputImages.length ? job.inputImages : await drive.importImages(job.driveUrl!, job);
  const imported: AutomationInput[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const image = inputs[index];
    const storagePath = `garments/drafts/${job.createdByUid}/${job.id}/${image.itemId}/${index}.jpg`;
    // Existing wizard uploads are copied into the generation input set.
    const bytes = image.storagePath ? (await bucket.file(image.storagePath).download())[0] : await downloadUrl(image.url!);
    const normalized = await normalizeInputImage(bytes);
    await bucket.file(storagePath).save(normalized, { resumable: false, metadata: { contentType: 'image/jpeg' } });
    imported.push({ itemId: image.itemId, fileName: image.fileName, storagePath });
  }
  return imported;
};
