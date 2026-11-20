import React from 'react';
import { Link } from 'react-router-dom';
import { Batch } from '../../../shared/src/types';
import { getJobFailureInfo, isFailureCancellation } from '../../features/catalog/errorMessage';
import { useBatchJobs } from '../../features/queue/firebase';
import { ImageThumb, Skeleton } from '../ui';

const MAX_VISIBLE_FAILURES = 8;

/** Failed jobs of one batch with the reason Gemini or the provider gave, so the operator can decide before retrying. */
export const QueueBatchFailures: React.FC<{ batch: Batch; catalogHref: string }> = ({ batch, catalogHref }) => {
  const { jobs, loading, error } = useBatchJobs(batch, true);

  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-label="Cargando trabajos fallidos">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-[var(--color-danger)]">{error}</p>;
  }

  const failedJobs = (jobs || []).filter((job) => job.status === 'failed');
  if (failedJobs.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Este lote ya no tiene trabajos fallidos.</p>;
  }

  const visible = failedJobs.slice(0, MAX_VISIBLE_FAILURES);
  const hidden = failedJobs.length - visible.length;

  return (
    <ul className="divide-y divide-[var(--color-border-subtle)]">
      {visible.map((job) => {
        const failure = getJobFailureInfo(job);
        const cancelled = isFailureCancellation(failure);
        return (
          <li key={job.id} className="flex items-start gap-3 py-2.5">
            <div className="h-12 w-12 shrink-0">
              <ImageThumb storagePath={job.garmentFilePath} alt={job.garmentName} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                {job.garmentName}
                {job.poseFileName ? <span className="font-normal text-[var(--color-text-muted)]"> · {job.poseFileName}</span> : null}
              </p>
              <p className={`text-xs font-medium ${cancelled ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-danger)]'}`}>
                {failure?.title || 'Falló sin detalle'}
              </p>
              {failure?.userMessage && failure.userMessage !== failure.title ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-text-secondary)]">{failure.userMessage}</p>
              ) : null}
            </div>
          </li>
        );
      })}
      {hidden > 0 ? (
        <li className="py-2.5 text-xs text-[var(--color-text-muted)]">
          y {hidden} más · <Link to={catalogHref} className="font-medium text-[var(--color-accent)] hover:underline">ver todos en el catálogo</Link>
        </li>
      ) : null}
    </ul>
  );
};
