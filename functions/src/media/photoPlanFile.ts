import sharp from 'sharp';
import type { PhotoTask } from '../../../shared/src/types';
export const SYNTHETIC_PERFORMER_SUBJECT = 'contains-synthetic-performer';
const XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii');
export function addSyntheticPerformerXmp(bytes: Buffer): Buffer {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('El XMP final requiere JPEG.');
  const packet = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Bag><rdf:li>contains-synthetic-performer</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>', 'utf8');
  const payload = Buffer.concat([XMP_HEADER, packet]);
  const header = Buffer.alloc(4); header[0] = 0xff; header[1] = 0xe1; header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([bytes.subarray(0, 2), header, payload, bytes.subarray(2)]);
}
export function hasSyntheticPerformerXmp(bytes: Buffer): boolean {
  return bytes.includes(XMP_HEADER) && bytes.includes(Buffer.from(`<rdf:li>${SYNTHETIC_PERFORMER_SUBJECT}</rdf:li>`));
}
export async function inspectPlannedPhoto(bytes: Buffer, task: PhotoTask) {
  const metadata = await sharp(bytes, { failOn: 'warning' }).metadata();
  if (!metadata.width || !metadata.height || metadata.format !== 'jpeg' || bytes.length > 2_800_000) throw new Error('Archivo final fuera del perfil fotográfico.');
  const ratio = metadata.width / metadata.height;
  const tiktokRatio = Math.abs(ratio - .75) < .002 || Math.abs(ratio - 4 / 3) < .002;
  let whiteCorners = true;
  if (task.background === 'white') {
    for (const [left, top] of [[0, 0], [metadata.width - 8, 0], [0, metadata.height - 8], [metadata.width - 8, metadata.height - 8]]) {
      const pixels = await sharp(bytes).extract({ left, top, width: 8, height: 8 }).removeAlpha().raw().toBuffer();
      if ([...pixels].some(value => value !== 255)) whiteCorners = false;
    }
  }
  return { tiktokRatio, whiteCorners, xmp: hasSyntheticPerformerXmp(bytes) };
}

export async function validatePlannedPhotoReview(bytes: Buffer, task: PhotoTask, review: import('../review/geminiImageReview').GeneratedImageReviewResult) {
  if (!review.photoValidation) throw new Error('Falta validación por destino en la revisión del plan.');
  const technical = await inspectPlannedPhoto(bytes, task);
  const metadata = await sharp(bytes).metadata();
  for (const dest of review.photoValidation.destinations) {
    const minSide = dest.channel === 'shein' ? 900 : dest.channel === 'tiktok-shop' ? 600 : 500;
    const requiredXmp = dest.channel === 'amazon' && task.syntheticPerformer;
    const whiteRequired = task.background === 'white' && dest.position === 1 && ['amazon', 'tiktok-shop'].includes(dest.channel);
    if (dest.channel === 'tiktok-shop' && !technical.tiktokRatio || requiredXmp && !technical.xmp || whiteRequired && !technical.whiteCorners || Math.min(metadata.width!, metadata.height!) < minSide) {
      dest.passed = false; dest.notes += ' Archivo final: revisar resolución, proporción, blanco RGB o XMP requerido.';
    }
  }
  if (!review.photoValidation.fidelity || !review.photoValidation.destinations.some(d => d.passed)) {
    review.verdict = 'rejected';
    review.summary += ' Hay validaciones obligatorias por destino pendientes en el archivo final.';
  }
}
