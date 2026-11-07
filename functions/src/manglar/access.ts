import { humanClientIds } from '../../../shared/src/clientAccess';
import { HttpsError } from 'firebase-functions/v2/https';
import { getAppFirestore } from '../firebase/appFirestore';
import type { Role, User } from '../../../shared/src/types';
import type { DelegatedCaller } from './context';
export interface ManglarAccess {
    enabled: boolean;
    clientIds: string[] | null;
    version: number;
}
export const validId = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[\w-]{1,200}$/.test(value))
        throw new HttpsError('invalid-argument', 'Identificador inválido.');
    return value;
};
export const loadManglarUser = async (uid: string): Promise<User> => {
    const user = (await getAppFirestore().collection('users').doc(uid).get()).data() as User | undefined;
    if (!user || user.active !== true || user.status === 'archived' || !['admin', 'operador', 'revisor'].includes(user.role))
        throw new HttpsError('permission-denied', 'La cuenta de Tuto no está activa.');
    return user;
};
export const loadManglarAccess = async (uid: string, role: Role): Promise<ManglarAccess> => {
    const data = (await getAppFirestore().collection('manglarAccess').doc(uid).get()).data();
    // An active Tuto admin already has system-wide access. Other roles need an explicit client assignment.
    if (!data)
        return { enabled: role === 'admin', clientIds: role === 'admin' ? null : [], version: 0 };
    if (typeof data.enabled !== 'boolean' || !Number.isInteger(data.version) || (data.clientIds !== null && (!Array.isArray(data.clientIds) || data.clientIds.some((id: unknown) => typeof id !== 'string')))
        || (role !== 'admin' && data.clientIds === null))
        throw new HttpsError('permission-denied', 'Permisos MCP inválidos.');
    const user = await loadManglarUser(uid);
    const humanIds = humanClientIds(user);
    return { ...data, clientIds: humanIds === null ? data.clientIds : data.clientIds === null ? humanIds : data.clientIds.filter((id: string) => humanIds.includes(id)) } as ManglarAccess;
};
export const assertClientAccess = (caller: DelegatedCaller, id: unknown): string => {
    const clientId = validId(id);
    if (caller.allowedClientIds !== null && !caller.allowedClientIds.includes(clientId))
        throw new HttpsError('permission-denied', 'Cliente fuera del alcance de esta conexión.');
    return clientId;
};
export const assertResourceAccess = async (caller: DelegatedCaller, collection: 'jobs' | 'batches' | 'automationJobs' | 'automationPlans' | 'models', id: unknown) => {
    const snapshot = await getAppFirestore().collection(collection).doc(validId(id)).get();
    const data = snapshot.data();
    if (!data)
        throw new HttpsError('not-found', 'Recurso no disponible.');
    assertClientAccess(caller, data.clientId);
    // Operators never inherit another operator's production. Reviewers have explicitly assigned clients.
    if (caller.role === 'operador' && collection !== 'models' && data.createdByUid !== caller.uid)
        throw new HttpsError('permission-denied', 'La producción pertenece a otro usuario.');
    return { ...data, id: snapshot.id } as Record<string, any> & {
        id: string;
    };
};
export const assertStorageAccess = async (caller: DelegatedCaller, value: unknown): Promise<string> => {
    if (typeof value !== 'string' || value.length > 1024 || value.split('/').some((part) => !part || part === '.' || part === '..') || /[\\\u0000-\u001f%?#]/.test(value))
        throw new HttpsError('invalid-argument', 'Ruta de Storage inválida.');
    const parts = value.split('/');
    if ((parts[0] === 'garments' && parts[1] === 'drafts' && parts[2] === caller.uid)
        || (['wizard_source_spreadsheets', 'model_imports'].includes(parts[0]) && parts[1] === caller.uid))
        return value;
    if (parts[0] === 'generated' && parts.length === 5) {
        const job = await assertResourceAccess(caller, 'jobs', parts[3]);
        if (job.clientId === parts[1] && job.batchId === parts[2])
            return value;
    }
    if (parts[0] === 'models' && parts.length === 5 && parts[3] === 'poses') {
        const model = await assertResourceAccess(caller, 'models', parts[2]);
        const root = model.storageRootPath || `models/${model.clientId}/${model.id}`;
        if (value.startsWith(`${root}/poses/`))
            return value;
    }
    if (['client_spreadsheets', 'client_spreadsheet_exports', 'model_generations'].includes(parts[0]) && caller.role !== 'operador') {
        assertClientAccess(caller, parts[1]);
        return value;
    }
    throw new HttpsError('permission-denied', 'Archivo fuera del alcance de esta conexión.');
};
// Called again by assertCallableRoles inside the existing business handlers.
export const authorizeManglarInput = async (caller: DelegatedCaller, input: unknown): Promise<void> => {
    if (!input || typeof input !== 'object')
        return;
    if (Array.isArray(input)) {
        for (const item of input)
            await authorizeManglarInput(caller, item);
        return;
    }
    for (const [key, value] of Object.entries(input)) {
        if (value === undefined || value === null || value === '')
            continue;
        if (key === 'clientId')
            assertClientAccess(caller, value);
        if (['jobId', 'batchId', 'modelId', 'planId'].includes(key) && typeof value === 'string') {
            await assertResourceAccess(caller, ({ jobId: 'jobs', batchId: 'batches', modelId: 'models', planId: 'automationPlans' } as const)[key as 'jobId'], value);
        }
        if (key === 'jobIds' && Array.isArray(value))
            for (const id of value)
                await assertResourceAccess(caller, 'jobs', id);
        if (['storagePath', 'referenceStoragePath'].includes(key))
            await assertStorageAccess(caller, value);
        if (key === 'referencePaths' && Array.isArray(value))
            for (const path of value)
                await assertStorageAccess(caller, path);
        if (typeof value === 'object')
            await authorizeManglarInput(caller, value);
    }
};
export const requireUnrestrictedAdmin = (caller: DelegatedCaller): void => {
    if (caller.role !== 'admin' || caller.allowedClientIds !== null)
        throw new HttpsError('permission-denied', 'Se necesita un administrador sin restricciones de cliente.');
};
export const delegatedStamp = (caller: DelegatedCaller) => ({ uid: caller.uid, connectionId: caller.connectionId, role: caller.role, accessVersion: caller.accessVersion });
export const assertDelegatedStamp = async (stamp: ReturnType<typeof delegatedStamp>, clientId: string): Promise<void> => {
    const user = await loadManglarUser(stamp.uid);
    const access = await loadManglarAccess(stamp.uid, user.role);
    if (!access.enabled || access.version !== stamp.accessVersion || user.role !== stamp.role || access.clientIds !== null && !access.clientIds.includes(clientId))
        throw new HttpsError('permission-denied', 'Permiso delegado de producción revocado.');
    const { oauthHash } = await import('../automation/mcpOAuth.helpers');
    const grant = (await getAppFirestore().collection('automationOAuth').doc(`grant-${oauthHash(stamp.connectionId)}`).get()).data();
    if (!grant?.active || grant.ownerUid !== stamp.uid || grant.expiresAt.toMillis() <= Date.now())
        throw new HttpsError('permission-denied', 'Conexión de producción revocada o vencida.');
};

/** A caller or grant captured earlier cannot retain a client removed from the current scope. */
export const isClientScopeSubset = (current: string[] | null, previous: string[] | null) =>
    current === null || previous !== null && previous.every(id => current.includes(id));
