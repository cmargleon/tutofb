import { FieldPath, type CollectionReference, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { getAppFirestore } from '../firebase/appFirestore';
import type { OrganizerConfig, OrganizerMode, OrganizerPage, OrganizerRun, OrganizerSettings } from '../../../shared/src/types';
import { digest, type DriveWriteAttempt } from './drive';
import type { delegatedStamp } from '../manglar/access';

export const configs = () => getAppFirestore().collection('organizers');
export const clientRef = (clientId: string) => configs().doc(clientId);
export const runRef = (clientId: string, runId: string) => clientRef(clientId).collection('runs').doc(runId);
export interface StoredConfig extends OrganizerConfig {
  generationActor?: { uid: string; delegated: StoredRun['delegated'] };
  observedFingerprint: string | null;
  observedAt: number | null;
  processedFingerprint: string | null;
  changeCursor: string | null;
  lastFullScanAt: number | null;
  blockedFingerprint: string | null;
}
export interface StoredRun extends OrganizerRun {
  generationUid?: string | null;
  maxCalls?: number;
  expectedFingerprint?: string | null;
  cursor: string | null;
  lease: string | null;
  leaseUntil: number;
  fingerprint: string | null;
  variantId: string | null;
  photoIds: string[];
  delegated: ReturnType<typeof delegatedStamp> | null;
  rootId: string | null;
  supersededBy?: string;
}
export const checkedId = (input: unknown): string => {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  return input;
};
export async function listPage<T>(source: FirebaseFirestore.Query, cursor?: string): Promise<OrganizerPage<T>> {
  const ordered = source.orderBy(FieldPath.documentId());
  const page = await (cursor ? ordered.startAfter(checkedId(cursor)) : ordered).limit(51).get();
  const docs = page.docs.slice(0, 50);
  return { items: docs.map(doc => ({ ...doc.data(), id: doc.id } as T)), next: page.size > 50 ? docs.at(-1)!.id : null };
}
export async function* documents(source: FirebaseFirestore.Query, cursor?: string | null) {
  const ordered = source.orderBy(FieldPath.documentId());
  let next = cursor;
  while (true) {
    const page = await (next ? ordered.startAfter(next) : ordered).limit(100).get();
    yield* page.docs;
    if (page.size < 100) return;
    next = page.docs.at(-1)!.id;
  }
}
export const publicConfig = (config: StoredConfig): OrganizerConfig => {
  const { generationActor: _actor, observedFingerprint: _observed, observedAt: _observedAt, processedFingerprint: _processed, changeCursor: _changes, lastFullScanAt: _scan, blockedFingerprint: _blocked, ...publicFields } = config;
  return publicFields;
};
export const publicRun = (run: StoredRun): OrganizerRun => {
  const { cursor: _cursor, lease: _lease, leaseUntil: _leaseUntil, fingerprint: _fingerprint, variantId: _variant, photoIds: _photos,
    generationUid: _generationUid, delegated: _delegated, rootId: _root, supersededBy: _superseded, ...publicFields } = run;
  return publicFields;
};
export const requiresCopy = (mode: OrganizerMode) => mode === 'classify' || mode === 'sync';
export async function enqueue(clientId: string, mode: OrganizerMode, key: string, actor: string, options: {
  confirmedBudgetUsd?: number; variantId?: string; photoIds?: string[]; delegated?: StoredRun['delegated']; automaticFingerprint?: string;
  planRunId?: string;
} = {}) {
  const ref = clientRef(clientId);
  const id = digest([clientId, actor, key]);
  const runDocument = runRef(clientId, id);
  return getAppFirestore().runTransaction(async tx => {
    const [snapshot, prior] = await tx.getAll(ref, runDocument);
    const config = snapshot.data() as StoredConfig | undefined;
    if (!config) throw new HttpsError('failed-precondition', 'Configura el organizador para este cliente.');
    if (prior.exists) {
      const run = prior.data() as StoredRun;
      if (run.mode !== mode || run.variantId !== (options.variantId || null) || JSON.stringify(run.photoIds) !== JSON.stringify(options.photoIds || []) || (run.planRunId || null) !== (options.planRunId || null))
        throw new HttpsError('already-exists', 'El identificador de solicitud ya se usó con otros parámetros.');
      return publicRun(run);
    }
    if (options.automaticFingerprint && (!config.enabled || config.activeRunId || config.observedFingerprint !== options.automaticFingerprint))
      return null;
    let generationActor = config.generationActor;
    if (actor === 'watcher' && !generationActor) {
      const history = await tx.get(ref.collection('runs').where('createdBy', '!=', 'watcher'));
      const last = history.docs.map(doc => doc.data() as StoredRun).filter(run => requiresCopy(run.mode))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (last) generationActor = { uid: last.createdBy, delegated: last.delegated || null };
    }
    if (!config.sourceIds.length) throw new HttpsError('failed-precondition', 'Selecciona al menos una carpeta de origen para iniciar el organizador.');
    const plan = options.planRunId ? (await tx.get(runRef(clientId, options.planRunId))).data() as StoredRun | undefined : null;
    if (options.planRunId && (!plan || plan.status !== 'completed' || plan.mode !== 'dry_run' || plan.counts.errors))
      throw new HttpsError('failed-precondition', 'La simulación debe estar completada.');
    if (config.activeRunId) {
      const active = (await tx.get(runRef(clientId, config.activeRunId))).data() as StoredRun | undefined;
      if (active?.status !== 'budget_exhausted' || !requiresCopy(mode) || actor === 'watcher' || options.confirmedBudgetUsd !== config.budgetUsd)
        throw new HttpsError('failed-precondition', 'Ya hay una ejecución activa. Consulta su estado antes de iniciar otra.');
      tx.update(runRef(clientId, active.id), { supersededBy: id, updatedAt: Date.now() });
    }
    if (requiresCopy(mode) && !options.automaticFingerprint && options.confirmedBudgetUsd !== config.budgetUsd)
      throw new HttpsError('failed-precondition', 'Confirma el presupuesto exacto configurado para iniciar la clasificación.');
    const now = Date.now();
    const run: StoredRun = { id, clientId, mode, status: 'queued', phase: 'inventory', createdAt: now, updatedAt: now,
      completedAt: null, createdBy: actor, budgetUsd: requiresCopy(mode) ? config.budgetUsd : 0, estimatedUsd: 0, reservedUsd: 0,
      uncertainUsd: 0, alerts: [], calls: 0, counts: {}, error: null, reportUrl: null, controlSheetUrl: null, cursor: null,
      lease: null, leaseUntil: 0, fingerprint: options.automaticFingerprint || null, variantId: options.variantId || null,
      photoIds: options.photoIds || [], delegated: options.delegated || (actor === 'watcher' ? generationActor?.delegated : null) || null,
      generationUid: actor === 'watcher' ? generationActor?.uid || config.operatorUids[0] || null : actor,
      rootId: null, maxCalls: config.maxCalls ?? 300,
      planRunId: options.planRunId || null, expectedFingerprint: plan?.fingerprint || null };
    tx.create(runDocument, run);
    tx.update(ref, { activeRunId: id, watcher: 'running', watcherError: null, ...(requiresCopy(mode) ? { blockedFingerprint: null,
      ...(actor !== 'watcher' ? { generationActor: { uid: actor, delegated: options.delegated || null } }
        : generationActor ? { generationActor } : {}) } : {}) });
    return publicRun(run);
  });
}
export function createAttemptRecorder(root: DocumentReference, runDocument: DocumentReference, lease: string): DriveWriteAttempt {
  const attempts = root.collection('driveAttempts');
  const record: DriveWriteAttempt = key => getAppFirestore().runTransaction(async tx => {
    const doc = attempts.doc(key);
    const [attempt, run] = await tx.getAll(doc, runDocument);
    assertLease(run.data() as StoredRun | undefined, lease);
    if (attempt.exists && attempt.data()?.state !== 'rejected') return false;
    const prior = attempt.data();
    tx.set(doc, { state: 'submitted', firstAt: prior?.firstAt || Date.now(), at: Date.now(),
      attempts: (prior?.attempts || 0) + 1, runId: run.id, lease });
    return true;
  });
  record.rejected = (key, status) => getAppFirestore().runTransaction(async tx => {
    const doc = attempts.doc(key);
    const prior = (await tx.get(doc)).data();
    if (prior?.state === 'submitted' && prior.lease === lease) tx.update(doc, { state: 'rejected', status, rejectedAt: Date.now() });
  });
  return record;
}
export function assertLease(run: StoredRun | undefined, lease: string): asserts run is StoredRun {
  if (!run || run.lease !== lease || run.status !== 'running' || run.leaseUntil < Date.now())
    throw new HttpsError('aborted', 'La ejecución ya no está activa.');
}
export async function whileLeased<T>(doc: DocumentReference, lease: string, apply: (tx: Transaction, run: StoredRun) => Promise<T> | T) {
  return getAppFirestore().runTransaction(async tx => {
    const run = (await tx.get(doc)).data() as StoredRun | undefined;
    assertLease(run, lease);
    return apply(tx, run);
  });
}
export const defaultConfig = (clientId: string, clientName: string, settings: OrganizerSettings): StoredConfig => ({
  ...settings, clientId, clientName, activeRunId: null, destinationId: null, watcher: settings.enabled ? 'idle' : 'disabled',
  lastSyncAt: null, lastClassifiedAt: null, watcherError: null, lastPollAt: null, changeCursor: null, lastFullScanAt: null, blockedFingerprint: null,
  observedFingerprint: null, observedAt: null, processedFingerprint: null,
});
export async function writePages<T extends object>(ref: CollectionReference, data: { id: string; value: T }[]) {
  for (let index = 0; index < data.length; index += 300) {
    const batch = getAppFirestore().batch();
    for (const entry of data.slice(index, index + 300)) batch.set(ref.doc(entry.id), entry.value);
    await batch.commit();
  }
}
