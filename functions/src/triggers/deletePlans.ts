export interface OutputDeleteCandidate {
  resultImagePath?: string;
  storageDeletedAt?: unknown;
}

export const extractLiveOutputPaths = (outputs: OutputDeleteCandidate[]): string[] =>
  Array.from(
    new Set(
      outputs
        .filter((output) => output.resultImagePath && !output.storageDeletedAt)
        .map((output) => output.resultImagePath as string),
    ),
  );
