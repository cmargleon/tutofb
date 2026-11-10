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
