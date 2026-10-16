import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { getAppFirestore } from '../firebase/appFirestore';
import { AutomationJobType } from '../../../shared/src/types';

export const AUTOMATION_ACCESS_TOKEN_SECONDS = 900;
export const MACHINE_SCOPES = ['uploads:write', 'jobs:create', 'jobs:read', 'jobs:retry'] as const;
export type MachineScope = typeof MACHINE_SCOPES[number];
export interface AutomationPrincipal {
  active: boolean;
  version: number;
  allowedClientIds: string[];
  allowedJobTypes: AutomationJobType[];
  scopes: MachineScope[];
  secretHashes: Array<{ hash: string; expiresAt: Timestamp | null }>;
}
export interface MachineCaller {
  uid: string;
  role: 'automation';
  principalId: string;
  principal: AutomationPrincipal;
  scopes: MachineScope[];
}
export const credentialHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const machineUid = (id: string): string => `automation-${id}`;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9-]{1,80}$/.test(id);
const equalHash = (first: string, second: string): boolean => /^[a-f0-9]{64}$/.test(first) && timingSafeEqual(Buffer.from(first, 'hex'), Buffer.from(second, 'hex'));
export const loadAutomationPrincipal = async (id: string): Promise<AutomationPrincipal> => {
  if (!validId(id)) throw new HttpsError('unauthenticated', 'Credencial de automatización inválida.');
  const snapshot = await getAppFirestore().collection('automationPrincipals').doc(id).get();
  const principal = snapshot.data() as AutomationPrincipal | undefined;
  if (!principal?.active || !Number.isInteger(principal.version)) throw new HttpsError('unauthenticated', 'Credencial de automatización inválida o revocada.');
  return principal;
};
export const assertMachineScope = (caller: MachineCaller, scope: MachineScope): void => {
  if (!caller.scopes.includes(scope)) throw new HttpsError('permission-denied', 'La identidad técnica no tiene este scope.');
};
export const assertMachineClient = (principal: AutomationPrincipal, clientId: unknown, jobType: unknown): void => {
  if (typeof clientId !== 'string' || !principal.allowedClientIds.includes(clientId) || !principal.allowedJobTypes.includes(jobType as AutomationJobType)) {
    throw new HttpsError('permission-denied', 'Cliente o tipo de producción fuera del alcance de la identidad técnica.');
  }
};
export const issueMachineToken = async (clientId: unknown, secret: unknown, scope?: unknown) => {
  if (!validId(clientId) || typeof secret !== 'string' || secret.length < 32 || secret.length > 512) throw new HttpsError('unauthenticated', 'Credenciales de cliente inválidas.');
  const requested = typeof scope === 'string' ? [...new Set(scope.split(' ').filter(Boolean))] : null;
  const db = getAppFirestore();
  const principalRef = db.collection('automationPrincipals').doc(clientId);
  const accessToken = `manglar_at_${randomBytes(32).toString('base64url')}`;
  const hash = credentialHash(secret);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(principalRef);
    const principal = snapshot.data() as AutomationPrincipal | undefined;
    if (!principal?.active || !principal.secretHashes?.some((entry) => equalHash(entry.hash, hash) && (!entry.expiresAt || entry.expiresAt.toMillis() > now))) {
      throw new HttpsError('unauthenticated', 'Credenciales de cliente inválidas.');
    }
    const scopes = requested || principal.scopes;
    if (!scopes.length || scopes.some((entry) => !principal.scopes.includes(entry as MachineScope))) throw new HttpsError('invalid-argument', 'invalid_scope');
    const rate = snapshot.data()?.tokenRate as { since: Timestamp; count: number } | undefined;
    const sameWindow = rate && now - rate.since.toMillis() < 60 * 60_000;
    if (sameWindow && rate.count >= 60) throw new HttpsError('resource-exhausted', 'Límite de renovación de tokens alcanzado.');
    tx.update(principalRef, { tokenRate: { since: sameWindow ? rate.since : Timestamp.fromMillis(now), count: sameWindow ? rate.count + 1 : 1 } });
    tx.create(db.collection('automationAccessTokens').doc(credentialHash(accessToken)), {
      principalId: clientId, version: principal.version, scopes,
      createdAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + AUTOMATION_ACCESS_TOKEN_SECONDS * 1000),
    });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: AUTOMATION_ACCESS_TOKEN_SECONDS, scope: scopes.join(' ') };
  });
};
export const verifyMachineToken = async (token: string): Promise<MachineCaller> => {
  if (!/^manglar_at_[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpsError('unauthenticated', 'Token inválido.');
  const snapshot = await getAppFirestore().collection('automationAccessTokens').doc(credentialHash(token)).get();
  const data = snapshot.data();
  if (!data || data.expiresAt.toMillis() <= Date.now()) throw new HttpsError('unauthenticated', 'Token expirado o revocado.');
  const principal = await loadAutomationPrincipal(data.principalId);
  if (principal.version !== data.version) throw new HttpsError('unauthenticated', 'Token revocado.');
  const scopes = (data.scopes as MachineScope[]).filter((scope) => principal.scopes.includes(scope));
  return { uid: machineUid(data.principalId), role: 'automation', principalId: data.principalId, principal, scopes };
};
export const authorizeMachineJob = async (uid: string, clientId: string, jobType: AutomationJobType): Promise<void> => {
  const principal = await loadAutomationPrincipal(uid.slice('automation-'.length));
  if (!principal.scopes.includes('jobs:create')) throw new HttpsError('permission-denied', 'Permiso de producción revocado.');
  assertMachineClient(principal, clientId, jobType);
};
export const pruneExpiredMachineTokens = async (): Promise<void> => {
  const db = getAppFirestore();
  const expired = await db.collection('automationAccessTokens').where('expiresAt', '<=', Timestamp.now()).limit(200).get();
  if (expired.empty) return;
  const batch = db.batch();
  expired.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
};
