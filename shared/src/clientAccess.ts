import type { User } from './types/user';
export type ClientAccess = { mode: 'global' } | { mode: 'assigned'; clientIds: string[] };
/** Missing or malformed assignments never confer global access. */
export const humanClientIds = (user: Pick<User, 'role' | 'clientAccess'>): string[] | null => {
  if (user.role === 'admin' || user.clientAccess?.mode === 'global') return null;
  return user.clientAccess?.mode === 'assigned' && Array.isArray(user.clientAccess.clientIds)
    && user.clientAccess.clientIds.every(id => typeof id === 'string' && /^[\w-]{1,200}$/.test(id))
    ? [...new Set(user.clientAccess.clientIds)] : [];
};
