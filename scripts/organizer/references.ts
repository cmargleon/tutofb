import type { classifyGarmentWithGemini } from '../../functions/src/callables/classifyGarmentViewsWithGemini';
import { type Catalog, type Entry, type Reference, requireFunctions, unique } from './catalog.ts';
import type { Drive } from './drive.ts';

type Classifier = typeof classifyGarmentWithGemini;
type Classification = Awaited<ReturnType<Classifier>>;
export interface Spend {
  calls: number; reservedUsd: number; estimatedUsd: number; errors: string[]; budgetUsd: number;
}
export const HOLD_USD = 0.05;
export const newSpend = (budgetUsd: number): Spend => ({ calls: 0, reservedUsd: 0, estimatedUsd: 0, errors: [], budgetUsd });
export function reserve(spend: Spend) {
  if (Math.round((spend.reservedUsd + HOLD_USD) * 100) > Math.floor(spend.budgetUsd * 100)) return false;
  spend.calls++;
  spend.reservedUsd = Number((spend.reservedUsd + HOLD_USD).toFixed(2));
  return true;
}
type GeminiPayload = Awaited<ReturnType<NonNullable<Parameters<Classifier>[0]['organizer']>['generate']>> & {
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};
const chunks = <T,>(all: T[], length: number) => Array.from({ length: Math.ceil(all.length / length) }, (_, i) => all.slice(i * length, (i + 1) * length));
export const referenceModel = 'gemini-3.1-flash-lite';

export async function analyzeReferences(
  files: Entry[], result: Catalog, drive: Pick<Drive, 'download'>, apiKey: string,
  spend: Spend, checkpoint: () => Promise<void>,
) {
  const admin = requireFunctions('firebase-admin') as typeof import('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'tutofb-260320-1003', storageBucket: 'tutofb-260320-1003.firebasestorage.app' });
  const { classifyGarmentWithGemini: classify } = requireFunctions('./lib/functions/src/callables/classifyGarmentViewsWithGemini.js') as { classifyGarmentWithGemini: Classifier };
  const sharp = requireFunctions('sharp') as typeof import('../../functions/node_modules/sharp');
  const byId = new Map(files.map(file => [file.id, file]));
  const byHash = new Map(result.associations.map(photo => [photo.fileId, photo.hash || photo.fileId]));
  const processed = new Set<string>();
  let providerUnavailable = false;
  const variants = [...result.variants].sort((a, b) => Number(b.status === 'PENDIENTES') - Number(a.status === 'PENDIENTES') ||
    Number(Boolean(b.rows.some(row => /ropa|talla/i.test(row.sheet)))) - Number(Boolean(a.rows.some(row => /ropa|talla/i.test(row.sheet)))) ||
    b.images.length - a.images.length || a.visual.localeCompare(b.visual));
  for (const variant of variants) {
    if (variant.reference || !variant.images.length) continue;
    const hashes = new Set<string>();
    const photos = variant.images.filter(id => {
      const key = byHash.get(id)!;
      if (hashes.has(key)) return false;
      hashes.add(key);
      return true;
    });
    const batches = chunks(photos, 4);
    const enough = () => Math.round((spend.reservedUsd + batches.length * HOLD_USD) * 100) <= Math.floor(spend.budgetUsd * 100);
    const process = async (ids: string[]): Promise<Classification> => classify({
      apiKey, model: referenceModel, categories: [], fallbackCategoryId: null,
      garment: { garmentId: variant.id, garmentName: variant.visual.slice(0, 100), photos: ids.map((id, sourceIndex) => ({
        id, sourceIndex, fileName: byId.get(id)!.name.slice(0, 100), storagePath: '',
      })) },
      organizer: {
        readImage: async id => ({
          bytes: await sharp(await drive.download(byId.get(id)!)).rotate()
            .resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 83 }).toBuffer(),
          mimeType: 'image/jpeg',
        }),
        generate: async body => {
          if (!reserve(spend)) throw new Error('Reserva Gemini agotada');
          for (const id of ids) processed.add(byHash.get(id)!);
          await checkpoint();
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${referenceModel}:generateContent`, {
            method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), redirect: 'error',
          });
          if (!response.ok) {
            if ([400, 401, 403, 404, 429].includes(response.status)) providerUnavailable = true;
            throw new Error(`Gemini HTTP ${response.status}`);
          }
          const payload = await response.json() as GeminiPayload;
          const usage = payload.usageMetadata;
          spend.estimatedUsd += usage
            ? ((usage.promptTokenCount || 0) * 0.25 + ((usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0)) * 1.5) / 1_000_000
            : HOLD_USD;
          return payload;
        },
      },
    });
    if (providerUnavailable) variant.reference = { state: 'Pendiente de análisis · proveedor no disponible' };
    else if (!enough()) variant.reference = { state: 'Pendiente de análisis · presupuesto' };
    else if (variant.issues.some(issue => /identificador|otra variante|mismo SKC/i.test(issue)) ||
        photos.some(id => processed.has(byHash.get(id)!))) {
      variant.reference = { state: 'Pendiente de análisis · identidad en revisión' };
    } else {
      try {
        const responses: Classification[] = [];
        for (const ids of batches) responses.push(await process(ids));
        variant.reference = selectReferences(responses);
        if (variant.reference.state !== 'Seleccionadas') {
          variant.issues.push('Referencias visuales insuficientes o tipo inconsistente');
          variant.status = 'REVISAR';
        }
      } catch (error) {
        const message = error instanceof Error && /^Gemini HTTP \d{3}$/.test(error.message) ? error.message : 'Error de lectura o clasificación';
        spend.errors.push(`${variant.visual} · ${message}`);
        variant.reference = { state: 'Pendiente de análisis · error' };
      }
    }
    await checkpoint();
  }
}
export function selectReferences(responses: Classification[]): Reference {
  const kinds = unique(responses.filter(batch => (batch.itemKindConfidence || 0) >= 0.7).map(batch => batch.itemKind).filter(Boolean));
  const kind = kinds.length === 1 ? kinds[0] : undefined;
  const photos = responses.flatMap(batch => batch.photos.map(photo => ({
    ...photo, score: batch.referenceQuality?.[photo.id] || 0,
  }))).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const eligible = photos.filter(photo => photo.score >= 0.63 && (kind === 'product' || (photo.confidence || 0) >= 0.7));
  const views = Object.fromEntries(photos.filter(photo => (photo.confidence || 0) >= 0.7).map(photo => [photo.id, photo.view]));
  const front = eligible.filter(photo => photo.view === 'front').slice(0, 2).map(photo => photo.id);
  const back = eligible.filter(photo => photo.view === 'back').slice(0, 2).map(photo => photo.id);
  const object = eligible.slice(0, 2).map(photo => photo.id);
  const selected = kind === 'garment' ? front.length && back.length : kind === 'product' && object.length;
  return { state: selected ? 'Seleccionadas' : 'Revisar · referencias insuficientes', kind: kind || undefined, views,
    ...(kind === 'garment' ? { front, back } : kind === 'product' ? { object } : {}) };
}
