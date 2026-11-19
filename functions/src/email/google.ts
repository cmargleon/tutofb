import { HttpsError } from 'firebase-functions/v2/https';
import { GMAIL_OAUTH_CLIENT } from '../config/runtime';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_CALLBACK_URL = 'https://us-central1-tutofb-260320-1003.cloudfunctions.net/gmailOAuthCallback';
export const EMAIL_APP_ORIGIN = 'https://tutofb-260320-1003.web.app';
export function gmailCredentials() {
  try {
    const data = JSON.parse(GMAIL_OAUTH_CLIENT.value()).web;
    if (typeof data?.client_id !== 'string' || typeof data?.client_secret !== 'string') throw new Error();
    return { clientId: data.client_id as string, secret: data.client_secret as string };
  } catch { throw new HttpsError('failed-precondition', 'Falta configurar la conexión de Gmail en el servidor.'); }
}
export async function gmailToken(parameters: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; scope?: string }> {
  const config = gmailCredentials();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.secret, ...parameters }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new HttpsError('failed-precondition', 'Google no autorizó el envío. Vuelve a conectar el buzón de Manglar.');
  const data = await response.json() as { access_token?: string; refresh_token?: string; scope?: string };
  if (!data.access_token) throw new HttpsError('unavailable', 'Google no devolvió una autorización válida.');
  return { ...data, access_token: data.access_token };
}
