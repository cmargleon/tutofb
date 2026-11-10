import { useCallback, useEffect, useMemo, useState } from 'react';
import { Job } from '../../../shared/src/types';
import {
  buildCatalogLightboxIndex,
  CatalogLightboxPosition,
  getNextLightboxTarget,
  getPreviousLightboxTarget,
  resolveLightboxJob,
} from './catalogView';
import { subscribeToCatalogJob } from './firebase';
import { CatalogGarmentGroup } from './useCatalogJobs';

export const useCatalogLightbox = (displayGarmentGroups: CatalogGarmentGroup[]) => {
  const [lightbox, setLightbox] = useState<CatalogLightboxPosition | null>(null);
  const [lightboxLiveJob, setLightboxLiveJob] = useState<Job | null>(null);

  const lightboxIndexByJobId = useMemo(() => buildCatalogLightboxIndex(displayGarmentGroups), [displayGarmentGroups]);

  useEffect(() => {
    if (!lightbox?.jobId) {
      setLightboxLiveJob(null);
      return undefined;
    }

    return subscribeToCatalogJob(
      lightbox.jobId,
      setLightboxLiveJob,
      () => setLightboxLiveJob(null),
    );
  }, [lightbox?.jobId]);

  const openLightboxForJob = useCallback((job: Job) => {
    if (!job.id) return;
    const indexes = lightboxIndexByJobId.get(job.id);
    if (!indexes) return;
    setLightbox({ jobId: job.id, ...indexes });
  }, [lightboxIndexByJobId]);

  const handleCloseLightbox = useCallback(() => setLightbox(null), []);

  const previousLightboxTarget = useMemo(
    () => getPreviousLightboxTarget(displayGarmentGroups, lightbox),
    [displayGarmentGroups, lightbox],
  );

  const nextLightboxTarget = useMemo(
    () => getNextLightboxTarget(displayGarmentGroups, lightbox),
    [displayGarmentGroups, lightbox],
  );

  const lightboxJob = useMemo(
    () => resolveLightboxJob(displayGarmentGroups, lightbox, lightboxIndexByJobId),
    [displayGarmentGroups, lightbox, lightboxIndexByJobId],
  );

  const resolvedLightboxJob = lightboxJob || lightboxLiveJob;

  return {
    lightbox,
    setLightbox,
    resolvedLightboxJob,
    previousLightboxTarget,
    nextLightboxTarget,
    openLightboxForJob,
    handleCloseLightbox,
  };
};
