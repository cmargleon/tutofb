import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import type { Client, GmailConnectionStatus, StartGmailConnectionRequest, StartGmailConnectionResponse, SendClientEmailRequest, ClientEmailReceipt, ListClientEmailsRequest, ListClientEmailsResponse } from '../../../shared/src/types';
import { MANGLAR_EMAIL_SENDER } from '../../../shared/src/email';
import { GMAIL_OAUTH_CLIENT } from '../config/runtime';
import { assertCallableRoles, assertUserRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { buildEmailMime, decryptEmailToken, emailClientId, emailFingerprint, encryptEmailToken, hashEmailValue, validateEmail } from './domain';
import { EMAIL_APP_ORIGIN, GMAIL_CALLBACK_URL, GMAIL_SEND_SCOPE, gmailCredentials, gmailToken } from './google';

const options = { secrets: [GMAIL_OAUTH_CLIENT], timeoutSeconds: 60 };
const connectionRef = () => getAppFirestore().collection('emailPrivate').doc('gmail');
const messagesRef = (clientId: string) => getAppFirestore().collection('emailPrivate').doc(clientId).collection('messages');
const requireClient = async (clientId: string) => {
  const client = (await getAppFirestore().collection('clients').doc(clientId).get()).data() as Client | undefined;
  if (!client) throw new HttpsError('not-found', 'Cliente no disponible.');
  if (client.status === 'archived') throw new HttpsError('failed-precondition', 'Reactiva el cliente antes de enviar correos.');
  return client;
};
export const getGmailConnection = onCall<Record<string, never>, Promise<GmailConnectionStatus>>(async request => {
  await assertCallableRoles(request, ['admin']);
  const connection = (await connectionRef().get()).data();
  return { sender: MANGLAR_EMAIL_SENDER, connected: connection?.connected === true };
});
export const startGmailConnection = onCall<StartGmailConnectionRequest, Promise<StartGmailConnectionResponse>>(options, async request => {
  await assertCallableRoles(request, ['admin']);
  const config = gmailCredentials();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const now = Date.now();
  await getAppFirestore().collection('emailOAuthStates').doc(hashEmailValue(state)).create({
    uid: request.auth!.uid, verifier, expiresAt: Timestamp.fromMillis(now + 10 * 60 * 1000),
    createdAt: FieldValue.serverTimestamp(),
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: GMAIL_CALLBACK_URL, response_type: 'code',
    scope: `openid email ${GMAIL_SEND_SCOPE}`, state, access_type: 'offline', prompt: 'consent',
    login_hint: MANGLAR_EMAIL_SENDER, code_challenge: Buffer.from(hashEmailValue(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString() };
});

export const gmailOAuthCallback = onRequest(options, async (request, response) => {
  response.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').set('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') { response.status(405).send('Método no permitido.'); return; }
  let validState = false;
  try {
    const state = request.query.state;
    if (typeof state !== 'string' || !/^[\w-]{43}$/.test(state)) throw new Error('invalid state');
    const db = getAppFirestore();
    const stateRef = db.collection('emailOAuthStates').doc(hashEmailValue(state));
    // Consume once, even on cancellation. No authorization codes or tokens enter logs.
    const saved = await db.runTransaction(async tx => {
      const snapshot = await tx.get(stateRef);
      const data = snapshot.data();
      if (!data || data.used === true || data.expiresAt.toMillis() < Date.now()) throw new Error('expired state');
      tx.update(stateRef, { used: true, verifier: FieldValue.delete() });
      return data;
    });
    validState = true;
    await assertUserRoles(saved.uid, undefined, ['admin']);
    if (request.query.error || typeof request.query.code !== 'string') throw new Error('oauth cancelled');
    const token = await gmailToken({ grant_type: 'authorization_code', code: request.query.code, redirect_uri: GMAIL_CALLBACK_URL, code_verifier: saved.verifier });
    if (!token.scope?.split(' ').includes(GMAIL_SEND_SCOPE) || !token.refresh_token) throw new Error('missing permission');
    const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000),
    });
    if (!identityResponse.ok) throw new Error('identity unavailable');
    const identity = await identityResponse.json() as { email?: string; email_verified?: boolean };
    if (identity.email?.toLowerCase() !== MANGLAR_EMAIL_SENDER || identity.email_verified !== true) throw new Error('wrong mailbox');
    // Recheck role after the external roundtrip, before making the connection effective.
    await assertUserRoles(saved.uid, undefined, ['admin']);
    await connectionRef().set({ connected: true, sender: MANGLAR_EMAIL_SENDER,
      token: encryptEmailToken(token.refresh_token, gmailCredentials().secret),
      connectedByUid: saved.uid, connectedAt: FieldValue.serverTimestamp(),
    });
    response.redirect(303, `${EMAIL_APP_ORIGIN}/configuracion?gmail=connected#correo`);
  } catch {
    if (validState) response.redirect(303, `${EMAIL_APP_ORIGIN}/configuracion?gmail=error#correo`);
    else response.status(400).send('La conexión venció o no es válida. Vuelve a la app e inicia la conexión de Gmail de nuevo.');
  }
});

export const disconnectGmail = onCall<Record<string, never>, Promise<{ disconnected: true }>>(options, async request => {
  await assertCallableRoles(request, ['admin']);
  // Remove locally first: Google revocation may be unavailable, but the app must stop sending.
  const previous = await getAppFirestore().runTransaction(async tx => {
    const ref = connectionRef(); const saved = (await tx.get(ref)).data();
    tx.set(ref, { connected: false, disconnectedByUid: request.auth!.uid, disconnectedAt: FieldValue.serverTimestamp() });
    return saved;
  });
  if (previous?.token) {
    try { await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: decryptEmailToken(previous.token, gmailCredentials().secret) }), signal: AbortSignal.timeout(10000),
    }); } catch { /* The local token is already removed. */ }
  }
  return { disconnected: true };
});

export const listClientEmails = onCall<ListClientEmailsRequest, Promise<ListClientEmailsResponse>>(async request => {
  await assertCallableRoles(request, ['admin']);
  const clientId = emailClientId(request.data?.clientId);
  const snapshot = await messagesRef(clientId).orderBy('createdAt', 'desc').limit(20).get();
  return { messages: snapshot.docs.map(doc => receipt(doc.id, doc.data())) };
});
const receipt = (id: string, data: FirebaseFirestore.DocumentData): ClientEmailReceipt => ({
  id, to: data.to, subject: data.subject, status: data.status,
  createdAt: data.createdAt.toDate().toISOString(),
});

export const sendClientEmail = onCall<SendClientEmailRequest, Promise<ClientEmailReceipt>>(options, async request => {
  await assertCallableRoles(request, ['admin']);
  const clientId = emailClientId(request.data?.clientId);
  const client = await requireClient(clientId);
  const input = validateEmail(request.data, client.contacts || []);
  const fingerprint = emailFingerprint(input);
  const db = getAppFirestore();
  const ref = messagesRef(clientId).doc(input.requestId);
  // A persistent claim precedes ALL network calls: retries with the same ID never send twice.
  const claimed = await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const data = existing.data()!;
      if (data.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Este envío ya corresponde a otro mensaje.');
      return { previous: receipt(ref.id, data), token: '' };
    }
    const connection = (await tx.get(connectionRef())).data();
    if (connection?.connected !== true || !connection.token) throw new HttpsError('failed-precondition', 'Conecta el buzón de Manglar antes de enviar.');
    const now = Date.now();
    const windowStart = connection.windowStartMs || 0;
    const count = now - windowStart < 60000 ? connection.windowCount || 0 : 0;
    if (count >= 10) throw new HttpsError('resource-exhausted', 'Espera un minuto antes de enviar más correos.');
    tx.update(connectionRef(), { windowStartMs: count ? windowStart : now, windowCount: count + 1 });
    tx.create(ref, { to: input.to, subject: input.subject, body: input.body, fingerprint, status: 'sending', createdAt: Timestamp.now(), createdByUid: request.auth!.uid });
    return { previous: null, token: connection.token as string };
  });
  if (claimed.previous) return claimed.previous;
  let attempted = false;
  try {
    const token = await gmailToken({ grant_type: 'refresh_token', refresh_token: decryptEmailToken(claimed.token, gmailCredentials().secret) });
    await assertCallableRoles(request, ['admin']);
    const currentClient = await requireClient(clientId);
    validateEmail(input, currentClient.contacts || []);
    const latestConnection = (await connectionRef().get()).data();
    if (latestConnection?.connected !== true || latestConnection.token !== claimed.token) throw new HttpsError('failed-precondition', 'La conexión cambió. Revisa el buzón antes de enviar.');
    attempted = true;
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: buildEmailMime(input) }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      // A server failure can be ambiguous: never retry automatically after contacting Gmail.
      attempted = response.status >= 500 || response.status === 408;
      throw new Error('gmail rejected request');
    }
    const result = await response.json() as { id?: string };
    if (!result.id) throw new Error('missing receipt');
    await ref.update({ status: 'sent', gmailMessageId: result.id, sentAt: FieldValue.serverTimestamp() });
  } catch {
    await ref.update({ status: attempted ? 'unknown' : 'failed', finishedAt: FieldValue.serverTimestamp() });
  }
  return receipt(ref.id, (await ref.get()).data()!);
});
