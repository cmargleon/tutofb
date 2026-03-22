import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ArchiveSearchRequest, ArchiveSearchResponse, Batch, Job } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asOptionalTrimmedString = (value: unknown): string | null => {
  const trimmed = asTrimmedString(value);
  return trimmed ? trimmed : null;
};

const toMillis = (value: unknown): number => {
  if (!value) {
    return 0;
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const matchesText = (value: string | undefined, queryText: string) =>
  !queryText || (value || '').toLocaleLowerCase().includes(queryText);

export const searchArchive = onCall<ArchiveSearchRequest, Promise<ArchiveSearchResponse>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

  const db = getAppFirestore();
  const clientId = asTrimmedString(request.data?.clientId);
  const provider = asTrimmedString(request.data?.provider);
  const batchStatus = asTrimmedString(request.data?.batchStatus);
  const jobStatus = asTrimmedString(request.data?.jobStatus);
  const modelQuery = asTrimmedString(request.data?.modelQuery).toLocaleLowerCase();
  const limit = clamp(request.data?.limit, 1, 40, 20);
  const scanLimit = clamp(request.data?.scanLimit, limit, 160, Math.max(limit * 4, 80));

  let batchesQuery = db.collection('batches').orderBy('createdAt', 'desc').limit(scanLimit);
  const dateFrom = asTrimmedString(request.data?.dateFrom);
  const dateTo = asTrimmedString(request.data?.dateTo);

  if (dateFrom) {
    const fromDate = new Date(`${dateFrom}T00:00:00`);
    if (Number.isNaN(fromDate.getTime())) {
      throw new HttpsError('invalid-argument', 'La fecha inicial no es válida.');
    }

    batchesQuery = batchesQuery.where('createdAt', '>=', fromDate);
  }

  if (dateTo) {
    const toDate = new Date(`${dateTo}T23:59:59`);
    if (Number.isNaN(toDate.getTime())) {
      throw new HttpsError('invalid-argument', 'La fecha final no es válida.');
    }

    batchesQuery = batchesQuery.where('createdAt', '<=', toDate);
  }

  const batchesSnapshot = await batchesQuery.get();
  const scannedBatches = batchesSnapshot.size;
  const candidateBatches = batchesSnapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as Batch)
    .filter((batch) => {
      if (clientId && batch.clientId !== clientId) {
        return false;
      }

      if (provider && batch.provider !== provider) {
        return false;
      }

      if (batchStatus && batch.status !== batchStatus) {
        return false;
      }

      if (!matchesText(batch.modelNameSnapshot, modelQuery)) {
        return false;
      }

      return true;
    });

  const results: ArchiveSearchResponse['results'] = [];

  for (const batch of candidateBatches) {
    if (results.length >= limit) {
      break;
    }

    const jobsSnapshot = await db.collection('jobs').where('batchId', '==', batch.id).get();
    const matchedJobs = jobsSnapshot.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as Job)
      .filter((job) => {
        if (jobStatus && job.status !== jobStatus) {
          return false;
        }

        if (provider && job.provider !== provider) {
          return false;
        }

        return true;
      });

    if (matchedJobs.length === 0) {
      continue;
    }

    results.push({
      batch,
      matchedJobCount: matchedJobs.length,
      matchedJobIds: matchedJobs.map((job) => job.id!).filter(Boolean),
      matchedGarments: Array.from(
        new Set(
          matchedJobs
            .map((job) => asOptionalTrimmedString(job.garmentName))
            .filter((garmentName): garmentName is string => Boolean(garmentName)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
      latestMatchedAt: matchedJobs.reduce<unknown>((latest, job) => {
        const current = job.updatedAt || job.createdAt;
        return toMillis(current) > toMillis(latest) ? current : latest;
      }, batch.updatedAt || batch.createdAt) as Batch['updatedAt'],
    });
  }

  return {
    success: true,
    results,
    scannedBatches,
    truncated: candidateBatches.length > results.length || scannedBatches >= scanLimit,
  };
});
