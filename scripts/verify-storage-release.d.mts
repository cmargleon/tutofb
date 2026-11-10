export interface IamPolicy {
  bindings?: Array<{ role: string; members?: string[]; condition?: unknown }>;
}

export interface StorageCorsRule {
  origin?: string[];
  method?: string[];
  responseHeader?: string[];
  maxAgeSeconds?: number;
}

export function assertStorageFirestoreAccess(policy: IamPolicy, projectNumber: string | number): void;
export function assertStorageCors(actual: StorageCorsRule[] | null | undefined, expected: StorageCorsRule[] | null | undefined): void;
