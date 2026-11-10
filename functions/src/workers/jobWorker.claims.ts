import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { Job, JobLog } from '../../../shared/src/types';
import { getJobTimeoutMs } from '../config/runtime';
import { db } from './jobWorker.resources';

export const createLog = async (jobId: string, input: Omit<JobLog, 'createdAt'>): Promise<void> => {
  await db.collection('jobs').doc(jobId).collection('logs').add({
    ...input,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

export const isClaimStillActive = async (jobId: string, claimToken: string | null): Promise<boolean> => {
  if (!claimToken) {
    return false;
  }

  const snapshot = await db.collection('jobs').doc(jobId).get();
  if (!snapshot.exists) {
    return false;
  }

  const job = { id: snapshot.id, ...snapshot.data() } as Job;
  return job.status === 'processing' && job.claimToken === claimToken;
};

export const claimJob = async (jobId: string, workerId: string): Promise<Job | null> => {
  const jobRef = db.collection('jobs').doc(jobId);
  const claimExpiresAt = Timestamp.fromMillis(Date.now() + getJobTimeoutMs());
  const claimToken = randomUUID();
  const startedAt = Timestamp.now();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) {
      return null;
    }

    const job = { id: snapshot.id, ...snapshot.data() } as Job;
    const managedAutomation = Boolean(job.automationJobId) && job.automationManaged !== false;
    if (job.status !== 'pending' || (managedAutomation && job.automationGate)) {
      return null;
    }

    transaction.update(jobRef, {
      ...(managedAutomation ? { automationManaged: true } : {}),
      status: 'processing',
      claimToken,
      claimedBy: workerId,
      claimExpiresAt,
      timeoutAt: claimExpiresAt,
      retryNotBefore: null,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastAttemptStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      'traceability.lastAttemptStartedAt': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: null,
      failureInfo: null,
    });

    return {
      ...job,
      ...(managedAutomation ? { automationManaged: true } : {}),
      status: 'processing',
      claimToken,
      claimedBy: workerId,
      claimExpiresAt,
      timeoutAt: claimExpiresAt,
      startedAt,
      lastAttemptStartedAt: startedAt,
      lastError: null,
      failureInfo: null,
    };
  });
};
