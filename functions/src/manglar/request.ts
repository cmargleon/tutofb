import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DelegatedCaller } from './context';
// Internal adapter only. Never mints a Firebase token or accepts a caller-supplied identity.
export const callableRequest = <T>(data: T, caller: DelegatedCaller): CallableRequest<T> => ({
    data, auth: { uid: caller.uid, token: { uid: caller.uid, sub: caller.uid, role: caller.role } },
} as unknown as CallableRequest<T>);
