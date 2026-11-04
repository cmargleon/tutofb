import { loadManglarUser, loadManglarAccess } from '../manglar/access';
import type { DelegatedCaller } from '../manglar/context';
import type { Role } from '../../../shared/src/types';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { DecideManglarConnectionRequest, ManglarConnection, ManglarConnectionDetails, ManglarConnectionRedirect, ManglarConnectionRequest } from '../../../shared/src/types';
import { assertCallableRoles, assertUserRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { loadAutomationPrincipal, machineUid, type MachineCaller, type MachineScope } from './machineAuth';
import { MANGLAR_MCP_RESOURCE, MANGLAR_ORIGIN, OAuthError, type OAuthAuthorization, oauthHash, oauthRedirect, opaqueValue, parseAuthorization, pkceChallenge, requireOAuthString, validateRequestId } from './mcpOAuth.helpers';

const ACCESS_SECONDS = 900;
const GRANT_MS = 30 * 24 * 60 * 60_000;
const ref = (kind: string, value: string) => getAppFirestore().collection('automationOAuth').doc(`${kind}-${oauthHash(value)}`);
const future = (milliseconds: number) => Timestamp.fromMillis(Date.now() + milliseconds);
const current = (value: { expiresAt: Timestamp } | undefined): boolean => Boolean(value && value.expiresAt.toMillis() > Date.now());
interface Pending extends OAuthAuthorization { kind: 'request'; expiresAt: Timestamp; used: boolean }
interface Grant {
  id: string; kind: 'grant'; ownerUid: string; clientId: string; resource: string; scopes: string[];
  authorizationModel?: 'user-v1'; role?: Role; allowedClientIds?: string[] | null; accessVersion?: number;
  principalVersion: number; active: boolean; createdAt: Timestamp; expiresAt: Timestamp;
}
interface Code { kind: 'code'; grantId: string; redirectUri: string; challenge: string; clientId: string; expiresAt: Timestamp; used: boolean }
interface Token { kind: 'access' | 'refresh'; grantId: string; expiresAt: Timestamp; used?: boolean }

export const beginManglarAuthorization = async (query: Record<string, unknown>): Promise<string> => {
  const request = await parseAuthorization(query);
  const requestId = opaqueValue();
  await ref('request', requestId).create({ ...request, kind: 'request', used: false, expiresAt: future(10 * 60_000) });
  return `${MANGLAR_ORIGIN}/automation/connect?request=${requestId}`;
};
const requireAdmin = async (uid: string): Promise<void> => { await assertUserRoles(uid, undefined, ['admin']); };
const readPending = async (requestId: string): Promise<Pending> => {
  validateRequestId(requestId);
  const data = (await ref('request', requestId).get()).data() as Pending | undefined;
  if (!current(data) || data!.kind !== 'request' || data!.used) throw new HttpsError('failed-precondition', 'La solicitud venció o ya fue utilizada. Vuelve a conectar desde ChatGPT.');
  return data!;
};
export const manglarConnectionDetails = async (requestId: string, uid: string): Promise<ManglarConnectionDetails> => {
  const user = await loadManglarUser(uid);
  const access = await loadManglarAccess(uid, user.role);
  if (!access.enabled) throw new HttpsError('permission-denied', 'Un administrador debe habilitar tu acceso MCP y asignar clientes.');
  const request = await readPending(requestId);
  const clients = access.clientIds === null
    ? (await getAppFirestore().collection('clients').limit(500).get()).docs
    : access.clientIds.length ? await getAppFirestore().getAll(...access.clientIds.map((id) => getAppFirestore().collection('clients').doc(id))) : [];
  return { application: 'ChatGPT', scopes: request.scopes, role: user.role, unrestrictedClients: access.clientIds === null,
    expiresAt: request.expiresAt.toDate().toISOString(),
    clients: clients.filter((client) => client.exists && client.data()?.status !== 'archived').map((client) => ({ id: client.id, name: client.data()!.name })) };
};
export const decideManglarAuthorization = async (input: DecideManglarConnectionRequest, uid: string): Promise<ManglarConnectionRedirect> => {
  const user = await loadManglarUser(uid);
  const access = await loadManglarAccess(uid, user.role);
  if (!access.enabled) throw new HttpsError('permission-denied', 'Acceso MCP deshabilitado.');
  validateRequestId(input?.requestId);
  if (typeof input.approve !== 'boolean') throw new HttpsError('invalid-argument', 'Decisión inválida.');
  const grantId = opaqueValue(); const code = opaqueValue();
  return getAppFirestore().runTransaction(async (tx) => {
    const requestRef = ref('request', input.requestId);
    const request = (await tx.get(requestRef)).data() as Pending | undefined;
    if (!current(request) || request!.kind !== 'request' || request!.used) throw new HttpsError('failed-precondition', 'La solicitud venció o ya fue utilizada.');
    const [userSnapshot, accessSnapshot] = await tx.getAll(getAppFirestore().collection('users').doc(uid), getAppFirestore().collection('manglarAccess').doc(uid));
    if (userSnapshot.data()?.active !== true || userSnapshot.data()?.status === 'archived' || userSnapshot.data()?.role !== user.role
      || (accessSnapshot.data()?.version ?? 0) !== access.version || accessSnapshot.data()?.enabled === false) throw new HttpsError('permission-denied', 'Permisos revocados.');
    tx.update(requestRef, { used: true });
    if (!input.approve) return { redirectUrl: oauthRedirect(request!, { error: 'access_denied' }) };
    tx.create(ref('grant', grantId), { id: grantId, kind: 'grant', ownerUid: uid, clientId: request!.clientId, resource: request!.resource,
      scopes: request!.scopes, authorizationModel: 'user-v1', role: user.role, allowedClientIds: access.clientIds, accessVersion: access.version, principalVersion: 0, active: true, createdAt: Timestamp.now(), expiresAt: future(GRANT_MS) } satisfies Grant);
    tx.create(ref('code', code), { kind: 'code', grantId, clientId: request!.clientId, redirectUri: request!.redirectUri,
      challenge: request!.challenge, used: false, expiresAt: future(120_000) } satisfies Code);
    return { redirectUrl: oauthRedirect(request!, { code }) };
  });
};
const readGrant = async (id: string): Promise<Grant> => {
  const grant = (await ref('grant', id).get()).data() as Grant | undefined;
  if (!current(grant) || grant!.kind !== 'grant' || !grant!.active || grant!.resource !== MANGLAR_MCP_RESOURCE) throw new OAuthError('invalid_grant', 'Conexión vencida o revocada.');
  if (grant!.authorizationModel === 'user-v1') {
    try {
      const user = await loadManglarUser(grant!.ownerUid);
      const access = await loadManglarAccess(grant!.ownerUid, user.role);
      if (!access.enabled || user.role !== grant!.role || access.version !== grant!.accessVersion) throw new Error('revoked');
    } catch { throw new OAuthError('invalid_grant', 'Permisos individuales revocados; vuelve a conectar.'); }
    return grant!;
  }
  let principal;
  try {
    await requireAdmin(grant!.ownerUid);
    principal = await loadAutomationPrincipal('chatgpt-work');
  } catch (error) {
    if (error instanceof HttpsError) throw new OAuthError('invalid_grant', 'Permisos revocados.');
    throw error;
  }
  if (principal.version !== grant!.principalVersion || grant!.scopes.some((scope) => !principal.scopes.includes(scope as MachineScope))) throw new OAuthError('invalid_grant', 'Permisos revocados.');
  return grant!;
};
export const isManglarConnectionActive = async (id: string): Promise<boolean> => { try { await readGrant(id); return true; } catch { return false; } };
export const exchangeManglarToken = async (body: Record<string, unknown>) => {
  if (body.resource !== MANGLAR_MCP_RESOURCE) throw new OAuthError('invalid_target', 'Recurso OAuth inválido.');
  const clientId = requireOAuthString(body.client_id);
  const refresh = body.grant_type === 'refresh_token';
  if (!refresh && body.grant_type !== 'authorization_code') throw new OAuthError('unsupported_grant_type', 'Grant no admitido.');
  const credential = requireOAuthString(refresh ? body.refresh_token : body.code, 200);
  if (refresh ? !/^manglar_rt_[A-Za-z0-9_-]{43}$/.test(credential) : !/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new OAuthError('invalid_grant', 'Credencial inválida.');
  const tokenRef = ref(refresh ? 'refresh' : 'code', credential);
  const initial = (await tokenRef.get()).data() as Code | Token | undefined;
  if (!current(initial)) throw new OAuthError('invalid_grant', 'Credencial vencida o revocada.');
  const grant = await readGrant(initial!.grantId);
  if (grant.clientId !== clientId) throw new OAuthError('invalid_client', 'Cliente OAuth incorrecto.');
  if (body.scope !== undefined && (typeof body.scope !== 'string' || body.scope.split(' ').filter(Boolean).sort().join(' ') !== [...grant.scopes].sort().join(' '))) throw new OAuthError('invalid_scope', 'La renovación conserva los permisos autorizados.');
  if (!refresh) {
    const code = initial as Code;
    if (code.clientId !== clientId || body.redirect_uri !== code.redirectUri || typeof body.code_verifier !== 'string'
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier) || pkceChallenge(body.code_verifier) !== code.challenge) throw new OAuthError('invalid_grant', 'Código, callback o PKCE incorrectos.');
  }
  const access = `manglar_mcp_${opaqueValue()}`; const nextRefresh = `manglar_rt_${opaqueValue()}`;
  const result = await getAppFirestore().runTransaction(async (tx) => {
    const [credentialSnapshot, grantSnapshot] = await tx.getAll(tokenRef, ref('grant', initial!.grantId));
    const stored = credentialSnapshot.data() as Code | Token | undefined;
    const currentGrant = grantSnapshot.data() as Grant | undefined;
    if (!current(stored) || !current(currentGrant) || !currentGrant!.active) throw new OAuthError('invalid_grant', 'Conexión vencida o revocada.');
    if (stored!.used) {
      if (refresh) tx.update(grantSnapshot.ref, { active: false, revokedAt: FieldValue.serverTimestamp(), reason: 'refresh_replay' });
      return { replayed: true } as const;
    }
    tx.update(tokenRef, { used: true });
    tx.create(ref('access', access), { kind: 'access', grantId: stored!.grantId, expiresAt: future(ACCESS_SECONDS * 1000) } satisfies Token);
    tx.create(ref('refresh', nextRefresh), { kind: 'refresh', grantId: stored!.grantId, used: false, expiresAt: grant.expiresAt } satisfies Token);
    return { replayed: false, access_token: access, refresh_token: nextRefresh, token_type: 'Bearer', expires_in: ACCESS_SECONDS,
      scope: grant.scopes.join(' '), resource: MANGLAR_MCP_RESOURCE } as const;
  });
  if (result.replayed) throw new OAuthError('invalid_grant', 'Credencial ya utilizada.');
  const { replayed: _, ...response } = result;
  return response;
};
export const verifyManglarMcpToken = async (authorization: string | undefined): Promise<MachineCaller | DelegatedCaller> => {
  const bearer = authorization?.match(/^Bearer (manglar_mcp_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!bearer) throw new HttpsError('unauthenticated', 'Conecta Manglar con ChatGPT.');
  const access = (await ref('access', bearer).get()).data() as Token | undefined;
  if (!current(access) || access!.kind !== 'access') throw new HttpsError('unauthenticated', 'Conexión vencida o revocada.');
  let grant: Grant;
  try { grant = await readGrant(access!.grantId); }
  catch { throw new HttpsError('unauthenticated', 'Conexión vencida o revocada.'); }
  if (grant.authorizationModel === 'user-v1') {
    return { uid: grant.ownerUid, role: grant.role!, connectionId: grant.id, scopes: grant.scopes,
      allowedClientIds: grant.allowedClientIds ?? null, accessVersion: grant.accessVersion! };
  }
  const principal = await loadAutomationPrincipal('chatgpt-work');
  if (principal.version !== grant.principalVersion) throw new HttpsError('unauthenticated', 'Permisos revocados.');
  return { uid: machineUid('chatgpt-work'), role: 'automation', principalId: 'chatgpt-work', principal, scopes: grant.scopes as MachineScope[] };
};
export const getManglarConnectionRequest = onCall<ManglarConnectionRequest, Promise<ManglarConnectionDetails>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  return manglarConnectionDetails(request.data?.requestId, request.auth!.uid);
});
export const decideManglarConnection = onCall<DecideManglarConnectionRequest, Promise<ManglarConnectionRedirect>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  if (request.data?.approve === true && request.data.authorizationModel !== 'user-v1') throw new HttpsError('failed-precondition', 'Actualiza la página de Manglar para revisar y autorizar los permisos individuales antes de conectar.');
  return decideManglarAuthorization(request.data, request.auth!.uid);
});
export const listManglarConnections = onCall<Record<string, never>, Promise<{ connections: ManglarConnection[] }>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']); await loadManglarUser(request.auth!.uid);
  const grants = await getAppFirestore().collection('automationOAuth').where('ownerUid', '==', request.auth!.uid).limit(100).get();
  const awaitGrantActive = new Set<string>();
  await Promise.all(grants.docs.filter((doc) => doc.data().kind === 'grant').map(async (doc) => { try { await readGrant(doc.data().id); awaitGrantActive.add(doc.data().id); } catch { /* expired/revoked */ } }));
  return { connections: grants.docs.filter((doc) => doc.data().kind === 'grant').map((doc) => {
    const grant = doc.data() as Grant & { id: string };
    return { id: grant.id, application: 'ChatGPT', createdAt: grant.createdAt.toDate().toISOString(), expiresAt: grant.expiresAt.toDate().toISOString(), active: grant.active && current(grant) && awaitGrantActive.has(grant.id) };
  }) };
});
export const revokeManglarConnection = onCall<{ connectionId: string }, Promise<{ revoked: true }>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']); await loadManglarUser(request.auth!.uid);
  const id = validateRequestId(request.data?.connectionId);
  await getAppFirestore().runTransaction(async (tx) => {
    const target = ref('grant', id); const grant = (await tx.get(target)).data() as Grant | undefined;
    if (!grant || grant.kind !== 'grant' || grant.ownerUid !== request.auth!.uid) throw new HttpsError('not-found', 'Conexión no encontrada.');
    tx.update(target, { active: false, revokedAt: FieldValue.serverTimestamp(), reason: 'owner_revoked' });
  });
  return { revoked: true };
});
