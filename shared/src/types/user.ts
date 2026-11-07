import type { TimestampLike, Role, CatalogEntityStatus } from './common';

export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  clientAccess?: import('../clientAccess').ClientAccess;
  status?: CatalogEntityStatus;
  archivedAt?: TimestampLike | null;
  archivedByUid?: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  lastLoginAt?: TimestampLike | null;
}

export interface PermanentDeleteAppUserRequest {
  uid: string;
}

export interface PermanentDeleteAppUserResponse {
  success: boolean;
  uid: string;
}

export interface ArchiveAppUserRequest {
  uid: string;
}

export interface ArchiveAppUserResponse {
  success: boolean;
  uid: string;
}

export interface RestoreAppUserRequest {
  uid: string;
}

export interface RestoreAppUserResponse {
  success: boolean;
  uid: string;
}

export interface SetUserClientAccessRequest {
  uid: string;
  clientAccess: import('../clientAccess').ClientAccess;
  expected: import('../clientAccess').ClientAccess | null;
}
export interface SetUserClientAccessResponse { success: boolean }
