import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ManglarAccessRequest, ManglarConnectionListRequest } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { isManglarConnectionActive } from '../automation/mcpOAuth';
import { oauthHash, validateRequestId } from '../automation/mcpOAuth.helpers';
import { loadManglarUser, loadManglarAccess, requireUnrestrictedAdmin, validId } from './access';
import type { DelegatedCaller } from './context';
import { sanitizeResult } from './reads';
export const listConnections = async (input: ManglarConnectionListRequest, caller: DelegatedCaller) => {
    const owner = input.ownerUid || caller.uid;
    if (owner !== caller.uid)
        requireUnrestrictedAdmin(caller);
    const grants = await getAppFirestore().collection('automationOAuth').where('ownerUid', '==', validId(owner)).limit(100).get();
    return { connections: await Promise.all(grants.docs.filter(doc => doc.data().kind === 'grant').map(async doc => {
            const grant = doc.data();
            return sanitizeResult({ id: grant.id, ownerUid: owner, role: grant.role || 'legacy_automation', authorizationModel: grant.authorizationModel || 'legacy', allowedClientIds: grant.allowedClientIds,
                scopes: grant.scopes, createdAt: grant.createdAt, expiresAt: grant.expiresAt, active: await isManglarConnectionActive(grant.id) });
        })) };
};
export const revokeConnection = async (connectionId: string, caller: DelegatedCaller) => {
    const id = validateRequestId(connectionId);
    const db = getAppFirestore();
    const ref = db.collection('automationOAuth').doc(`grant-${oauthHash(id)}`);
    await db.runTransaction(async (tx) => {
        const grant = (await tx.get(ref)).data();
        if (!grant || grant.kind !== 'grant')
            throw new HttpsError('not-found', 'Conexión no encontrada.');
        if (grant.ownerUid !== caller.uid)
            requireUnrestrictedAdmin(caller);
        tx.update(ref, { active: false, revokedAt: FieldValue.serverTimestamp(), revokedByUid: caller.uid, reason: 'mcp_revoked' });
    });
    return { revoked: true };
};
export const setUserAccess = async (input: ManglarAccessRequest, caller: DelegatedCaller) => {
    requireUnrestrictedAdmin(caller);
    const uid = validId(input.uid);
    const user = await loadManglarUser(uid);
    if (typeof input.enabled !== 'boolean' || input.clientIds !== null && (!Array.isArray(input.clientIds) || input.clientIds.length > 100) || input.clientIds === null && user.role !== 'admin')
        throw new HttpsError('invalid-argument', 'Asigna hasta 100 clientes explícitos; solo admin admite acceso global.');
    if (input.clientIds)
        for (const clientId of input.clientIds) {
            const snapshot = await getAppFirestore().collection('clients').doc(validId(clientId)).get();
            if (!snapshot.exists)
                throw new HttpsError('not-found', 'Cliente no encontrado.');
        }
    const ref = getAppFirestore().collection('manglarAccess').doc(uid);
    await getAppFirestore().runTransaction(async (tx) => {
        const existing = (await tx.get(ref)).data();
        tx.set(ref, { enabled: input.enabled, clientIds: input.clientIds === null ? null : [...new Set(input.clientIds)], version: (existing?.version || 0) + 1,
            updatedAt: FieldValue.serverTimestamp(), updatedByUid: caller.uid });
    });
    return { uid, enabled: input.enabled, clientIds: input.clientIds, reconnectionRequired: true };
};
export const getUserAccess = async (uid: string, caller: DelegatedCaller) => {
    if (uid !== caller.uid)
        requireUnrestrictedAdmin(caller);
    const user = await loadManglarUser(validId(uid));
    return { uid, role: user.role, ...await loadManglarAccess(uid, user.role) };
};
