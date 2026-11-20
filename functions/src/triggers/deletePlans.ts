export interface OutputDeleteCandidate {
  resultImagePath?: string;
  thumbnailPath?: string;
  storageDeletedAt?: unknown;
}

export const extractLiveOutputPaths = (outputs: OutputDeleteCandidate[]): string[] =>
  Array.from(
    new Set(
      outputs
        .filter((output) => output.resultImagePath && !output.storageDeletedAt)
        .flatMap((output) => [output.resultImagePath as string, ...(output.thumbnailPath ? [output.thumbnailPath] : [])]),
    ),
  );

export interface ModelDeleteInput {
  modelId: string;
  clientId?: string | null;
  storageRootPath?: string | null;
}

/**
 * Storage prefixes owned by a model: its uploaded assets (`storageRootPath` and the
 * default `models/{clientId}/{modelId}`) and the generated identity/pose assets under
 * `model_generations/{clientId}/{modelId}/`. Every prefix ends in `/` so that a model id
 * that is a prefix of another (`m1` vs `m10`) never deletes the sibling's files, and a
 * `storageRootPath` that does not end in the model id is ignored so a malformed value
 * can never wipe a whole client folder.
 */
export const modelStoragePrefixes = ({ modelId, clientId, storageRootPath }: ModelDeleteInput): string[] => {
  const prefixes = new Set<string>();
  const root = (storageRootPath || '').replace(/\/+$/, '');
  if (root && root.split('/').length >= 2 && root.split('/').pop() === modelId) prefixes.add(`${root}/`);
  if (clientId) {
    prefixes.add(`models/${clientId}/${modelId}/`);
    prefixes.add(`model_generations/${clientId}/${modelId}/`);
  }
  return Array.from(prefixes);
};

/**
 * Batches that held some of the model's jobs but are not owned by the model (mixed-model
 * batches carry no `batches.modelId`). They are kept, and their counters must be
 * recomputed after the model's jobs are deleted.
 */
export const batchesToRecomputeAfterModelDelete = (
  jobs: Array<{ batchId?: string | null }>,
  ownedBatchIds: Iterable<string>,
): string[] => {
  const owned = new Set(ownedBatchIds);
  return Array.from(new Set(
    jobs.map((job) => job.batchId).filter((id): id is string => typeof id === 'string' && id.length > 0 && !owned.has(id)),
  ));
};
