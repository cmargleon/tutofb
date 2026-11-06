import { FieldPath, FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { getAppFirestore } from '../firebase/appFirestore';
import type { BackupEntry, BackupVersion, EngineStore, ScanState, ScanTask } from './engine';
import { checkedId } from './policy';

export const backupConfigs = () => getAppFirestore().collection('driveBackups');
export const backupRef = (clientId: string) => backupConfigs().doc(checkedId(clientId));
export class FirestoreBackupStore implements EngineStore {
  constructor(readonly ref: DocumentReference, readonly runId: string, readonly assertLease: () => Promise<void>) {}
  private get run() { return this.ref.collection('runs').doc(this.runId); }
  async entry(sourceId: string): Promise<BackupEntry | null> { return (await this.ref.collection('entries').doc(sourceId).get()).data() as BackupEntry || null; }
  async saveEntry(entry: BackupEntry) { await this.assertLease(); await this.ref.collection('entries').doc(entry.sourceId).set(entry); }
  async version(key: string, value: BackupVersion) {
    await this.assertLease(); const ref = this.ref.collection('versions').doc(key);
    await getAppFirestore().runTransaction(async tx => { if (!(await tx.get(ref)).exists) tx.create(ref, value); });
  }
  async intent(key: string, allocate: () => Promise<string>): Promise<string> {
    await this.assertLease(); const doc = this.ref.collection('intents').doc(key);
    const existing = (await doc.get()).data()?.driveId;
    if (existing) return existing;
    const driveId = await allocate();
    return getAppFirestore().runTransaction(async tx => {
      const current = (await tx.get(doc)).data()?.driveId;
      if (current) return current;
      tx.create(doc, { driveId, at: Date.now() }); return driveId;
    });
  }
  async task(): Promise<ScanTask | null> {
    return (await this.run.collection('tasks').where('done', '==', false).limit(1).get()).docs[0]?.data() as ScanTask || null;
  }
  async saveTask(task: ScanTask) { await this.assertLease(); await this.run.collection('tasks').doc(task.sourceId).set({ ...task, done: false }); }
  async addTask(task: ScanTask) {
    await this.assertLease(); const doc = this.run.collection('tasks').doc(task.sourceId);
    await getAppFirestore().runTransaction(async tx => { if (!(await tx.get(doc)).exists) tx.create(doc, { ...task, done: false }); });
  }
  async doneTask(sourceId: string) { await this.assertLease(); await this.run.collection('tasks').doc(sourceId).update({ done: true }); }
  async entriesAfter(cursor: string): Promise<BackupEntry[]> {
    let query = this.ref.collection('entries').orderBy(FieldPath.documentId());
    if (cursor) query = query.startAfter(cursor);
    return (await query.limit(100).get()).docs.map(d => d.data() as BackupEntry);
  }
  async event(key: string, value: { action: string; sourceId?: string; message?: string }) {
    await this.assertLease(); await this.run.collection('events').doc(key).set({ ...value, at: Date.now() });
  }
  async saveState(state: ScanState) { await this.assertLease(); await this.ref.update({ scan: state }); }
  async count(kind: 'created' | 'updated' | 'unchanged' | 'failed' | 'retained', sourceId: string) {
    await this.assertLease();
    const counted = this.run.collection('counts').doc(sourceId);
    await getAppFirestore().runTransaction(async tx => {
      const prior = (await tx.get(counted)).data()?.kind as string | undefined;
      if (prior === kind || prior && prior !== 'failed') return;
      const update: Record<string, unknown> = { [`counts.${kind}`]: FieldValue.increment(1) };
      if (prior) update[`counts.${prior}`] = FieldValue.increment(-1);
      tx.update(this.ref, update); tx.set(counted, { kind });
    });
  }
}
