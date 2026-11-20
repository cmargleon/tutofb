import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationJob, CatalogSourceAlert, CatalogSourceAlerts, OrganizerPhoto } from '../../../shared/src/types';
import { commercialIdentityOf } from '../../../shared/src/organizerIdentity';
import { getAppFirestore } from '../firebase/appFirestore';
import { loadExportContext } from '../spreadsheets/marketplaceExportService';
import type { OrganizerCommercialLink } from './commerce';

/** Read-only projection: export blockers and operational warnings share the batch's item IDs. */
export async function readCatalogAlerts(clientId: string, batchId: string, uid: string): Promise<CatalogSourceAlerts> {
  const db = getAppFirestore();
  const batch = await db.doc(`batches/${batchId}`).get();
  if (!batch.exists || batch.get('clientId') !== clientId) throw new HttpsError('not-found', 'Lote no disponible.');
  const alerts: CatalogSourceAlert[] = [];
  const automationId = batch.get('automationJobId') as string | undefined;
  if (!automationId) {
    const origin = batch.get('organizerOrigin') as { variantId?: string; itemId?: string } | undefined;
    if (!origin?.variantId) return { alerts };
    const variant = await db.doc(`organizers/${clientId}/products/${origin.variantId}`).get();
    const references = variant.get('references') as Record<string, string[]> | undefined;
    for (const id of [...new Set(Object.values(references || {}).flat())]) {
      const snapshot = await db.doc(`organizers/${clientId}/photos/${id}`).get();
      if (!snapshot.exists) continue;
      const photo = commercialIdentityOf(snapshot.data() as OrganizerPhoto);
      if (photo.issue) alerts.push({ itemId: origin.itemId || null, severity: 'warning', message: photo.issue, photoId: id });
    }
    return { alerts };
  }
  const ref = db.doc(`automationJobs/${automationId}`);
  const automation = (await ref.get()).data() as AutomationJob | undefined;
  if (!automation || automation.clientId !== clientId) throw new HttpsError('not-found', 'Automatización no disponible.');
  const links = (await ref.collection('organizerCommerce').get()).docs.map(doc => doc.data() as OrganizerCommercialLink);
  const photoFor = (itemId: string) => links.find(link => link.itemId === itemId)?.photos[0]?.id || null;
  const context = await loadExportContext({ clientId, batchIds: [batchId] }, uid);
  for (const product of context.products) {
    if (product.organizer?.source.issue && !product.organizer.confirmedIdentity)
      alerts.push({ itemId: product.garmentId, severity: 'error', message: product.organizer.source.issue, photoId: photoFor(product.garmentId) });
  }
  for (const link of links) {
    for (const source of link.photos) {
      const snapshot = await db.doc(`organizers/${clientId}/photos/${source.id}`).get();
      if (!snapshot.exists) continue;
      const photo = commercialIdentityOf(snapshot.data() as OrganizerPhoto);
      const message = photo.issue || (photo.identityState === 'needs_review' ? 'Conflicto de identidad pendiente de revisión.' : null);
      if (message) alerts.push({ itemId: link.itemId, severity: 'warning', message, photoId: source.id });
    }
    if (link.category && !link.category.categoryId)
      alerts.push({ itemId: link.itemId, severity: 'warning', message: link.category.reason || 'Clasificación comercial incierta.', photoId: photoFor(link.itemId) });
  }
  for (const item of automation.items || []) {
    if (item.status === 'needs_attention' || item.issue)
      alerts.push({ itemId: item.itemId, severity: 'warning', message: item.issue?.message || 'Artículo pendiente de atención.', photoId: photoFor(item.itemId) });
  }
  const runId = automation.metadata?.organizerRunId;
  if (typeof runId === 'string' && /^[A-Za-z0-9_-]+$/.test(runId)) {
    const pending = await db.collection(`organizers/${clientId}/runs/${runId}/generationHandoffs`).where('status', '==', 'needs_attention').get();
    for (const handoff of pending.docs) {
      const data = handoff.data();
      alerts.push({ itemId: typeof data.itemId === 'string' ? data.itemId : null, severity: 'warning',
        message: typeof data.issue === 'string' ? data.issue : 'Artículo pendiente de atención en el Organizador.',
        photoId: Array.isArray(data.photoIds) && typeof data.photoIds[0] === 'string' ? data.photoIds[0] : null });
    }
  }
  if (automation.error) alerts.push({ itemId: null, severity: 'warning', message: automation.error.message, photoId: links[0]?.photos[0]?.id || null });
  return { alerts };
}
