import type { DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type {
  Batch, Job, OrganizerBaseProduct, OrganizerBatchOrigin, OrganizerGeneration,
  OrganizerProductContext, OrganizerProductWorkflow, OrganizerVariant,
} from '../../../shared/src/types';
import { toMillisOrZero } from '../../../shared/src/utils/dateUtils';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { getAppFirestore } from '../firebase/appFirestore';
import { productPhotoStatus } from '../../../shared/src/productWorkflow';
import { jobMasterProductId } from '../spreadsheets/masterProducts';
import { digest } from './drive';
import { checkedId, type StoredConfig } from './store';

export async function readWorkflowVariant(root: DocumentReference, variantId: string, expectedBase?: string) {
  const snapshot = await root.collection('products').doc(checkedId(variantId)).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Variante no disponible.');
  const variant = { ...snapshot.data(), id: snapshot.id } as OrganizerVariant;
  const baseProductId = digest([variant.base]);
  if (expectedBase !== undefined && checkedId(expectedBase) !== baseProductId)
    throw new HttpsError('not-found', 'La variante no pertenece al producto base solicitado.');
  return { variant, baseProductId };
}

export async function assertOrganizerWorkflowAccess(uid: string, clientId: string, canGenerate = false) {
  await assertHumanClientAccess(uid, clientId);
  const db = getAppFirestore();
  const root = db.collection('organizers').doc(clientId);
  const [user, config] = await db.getAll(db.collection('users').doc(uid), root);
  const role = user.get('role');
  if ((canGenerate && !['admin', 'operador'].includes(role)) || !config.exists ||
      (role !== 'admin' && !(config.data() as StoredConfig).operatorUids?.includes(uid)))
    throw new HttpsError('permission-denied', 'Cliente fuera de los permisos del organizador.');
  return root;
}

/** A deliberate wizard association is accepted only for a single article and an approved visual variant. */
export async function resolveOrganizerBatchOrigin(
  context: OrganizerProductContext | undefined, clientId: string, itemIds: string[], uid: string,
): Promise<OrganizerBatchOrigin | undefined> {
  if (context === undefined) return undefined;
  if (!context || context.clientId !== clientId || itemIds.length !== 1)
    throw new HttpsError('invalid-argument', 'La generación vinculada requiere un solo artículo del cliente seleccionado.');
  const root = await assertOrganizerWorkflowAccess(uid, clientId, true);
  const { variant, baseProductId } = await readWorkflowVariant(root, context.variantId, checkedId(context.baseProductId));
  if (variant.referenceState !== 'approved') throw new HttpsError('failed-precondition', 'Se requieren referencias aprobadas.');
  return { baseProductId, variantId: variant.id, itemId: itemIds[0] };
}

export async function readProductWorkflow(
  root: DocumentReference, variantId: string, expectedBase?: string, requestedBatchId?: string,
): Promise<OrganizerProductWorkflow> {
  const { variant, baseProductId } = await readWorkflowVariant(root, variantId, expectedBase);
  const clientId = root.id;
  const db = getAppFirestore();
  const context = { clientId, baseProductId, variantId };
  const batches = db.collection('batches');
  const automation = db.collection('automationJobs');
  const approvedViews = { front: 'Frontal', back: 'Trasera', main: 'Principal', complementary: 'Complementaria' };
  const views = new Map<string, string>();
  for (const [kind, label] of Object.entries(approvedViews)) {
    for (const id of variant.references[kind as keyof typeof approvedViews] || []) {
      if (!views.has(id)) views.set(id, label);
    }
  }
  const [baseDoc, variants, photos] = await Promise.all([
    root.collection('baseProducts').doc(baseProductId).get(),
    root.collection('products').where('base', '==', variant.base).select('visual', 'color', 'pack', 'capacity').get(),
    views.size ? db.getAll(...[...views.keys()].map(id => root.collection('photos').doc(id))) : [],
  ]);
  const base = baseDoc.data() as OrganizerBaseProduct | undefined;
  const references = photos.map(photo => ({
    id: photo.id, name: photo.get('name') || photo.id, sourceUrl: photo.get('copyUrl') || photo.get('sourceUrl') || null,
    view: views.get(photo.id)!,
  }));
  const matched = new Map<string, Set<string>>();
  const put = (batchId: string, itemId: string) => {
    if (!matched.has(batchId)) matched.set(batchId, new Set());
    matched.get(batchId)!.add(itemId);
  };
  const matchManual = (snapshot: FirebaseFirestore.DocumentSnapshot) => {
    const batch = snapshot.data() as Batch | undefined;
    if (batch?.clientId === clientId && batch.organizerOrigin?.variantId === variantId &&
        batch.organizerOrigin.baseProductId === baseProductId) put(snapshot.id, batch.organizerOrigin.itemId);
  };
  let pendingAutomation = 0;
  const findAutomationItems = async (request: FirebaseFirestore.DocumentSnapshot, batchIds: string[]) => {
    if (request.get('clientId') !== clientId) return;
    const links = await request.ref.collection('organizerCommerce').where('organizerVariantId', '==', variantId).select().get();
    for (const link of links.docs) for (const id of batchIds) put(id, link.id);
    if (links.size && !batchIds.length && ['pending', 'importing', 'processing'].includes(request.get('status'))) pendingAutomation++;
  };
  if (requestedBatchId !== undefined) {
    const batch = await batches.doc(checkedId(requestedBatchId)).get();
    matchManual(batch);
    const automationId = batch.get('automationJobId');
    if (batch.get('clientId') === clientId && automationId) {
      await findAutomationItems(await automation.doc(automationId).get(), [batch.id]);
    }
  } else {
    const [manual, automated] = await Promise.all([
      batches.where('clientId', '==', clientId).where('organizerOrigin.variantId', '==', variantId).select('clientId', 'organizerOrigin').get(),
      automation.where('clientId', '==', clientId).where('organizerCommerce', '==', true)
        .select('clientId', 'batchId', 'batchIds', 'status').get(),
    ]);
    manual.docs.forEach(matchManual);
    // The frozen intake link is historical evidence. Current photo associations can change.
    for (let offset = 0; offset < automated.size; offset += 25) {
      await Promise.all(automated.docs.slice(offset, offset + 25).map(doc => findAutomationItems(doc,
        [...new Set<string>([...(doc.get('batchIds') || []), doc.get('batchId')].filter(Boolean))])));
    }
  }
  const generations: OrganizerGeneration[] = [];
  const entries = [...matched.entries()];
  for (let offset = 0; offset < entries.length; offset += 25) {
    await Promise.all(entries.slice(offset, offset + 25).map(async ([batchId, items]) => {
      const snapshot = await batches.doc(batchId).get();
      if (snapshot.get('clientId') !== clientId) return;
      const batch = { ...snapshot.data(), id: snapshot.id } as Batch;
      const grouped = await Promise.all([...items].map(itemId => db.collection('jobs')
        .where('clientId', '==', clientId).where('batchId', '==', batchId).where('garmentId', '==', itemId).get()));
      const jobs = grouped.flatMap(group => group.docs.map(doc => ({ ...doc.data(), id: doc.id } as Job)));
      const itemIds = [...new Set(jobs.map(job => job.garmentId))];
      if (!itemIds.length) return;
      const counts = { approved: 0, inProgress: 0, cancelled: 0, attention: 0 };
      for (const job of jobs) counts[productPhotoStatus(job)]++;
      generations.push({ batchId, createdAt: toMillisOrZero(batch.createdAt), itemIds,
        masterProductIds: [...new Set(jobs.map(job => jobMasterProductId(batch, job)))], ...counts,
      });
    }));
  }
  if (requestedBatchId !== undefined && !generations.length)
    throw new HttpsError('not-found', 'El lote no pertenece a la variante solicitada o sus trabajos ya no están disponibles.');
  generations.sort((a, b) => b.createdAt - a.createdAt || a.batchId.localeCompare(b.batchId));
  return { context, baseName: base?.name || variant.name, variant,
    variants: variants.docs.map(doc => ({ id: doc.id, ...doc.data() }) as OrganizerProductWorkflow['variants'][number]),
    references, generations, pendingAutomation,
  };
}
