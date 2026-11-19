import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { MANGLAR_EMAIL_SENDER, MAX_EMAIL_BODY_LENGTH, MAX_EMAIL_SUBJECT_LENGTH } from '../../../shared/src/email';
import type { SendClientEmailRequest, ClientContact } from '../../../shared/src/types';

const invalid = (message: string): never => { throw new HttpsError('invalid-argument', message); };
export const emailClientId = (value: unknown): string => typeof value === 'string' && /^[\w-]{1,200}$/.test(value) ? value : invalid('Cliente inválido.');
export function validateEmail(input: SendClientEmailRequest, contacts: ClientContact[]): SendClientEmailRequest {
  const clientId = emailClientId(input?.clientId);
  if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) invalid('Identificador de envío inválido.');
  const to = typeof input.to === 'string' ? input.to.trim() : '';
  if (to.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(to)) invalid('Correo de destino inválido.');
  if (!contacts.some(contact => contact.email.trim().toLowerCase() === to.toLowerCase())) invalid('Selecciona un contacto guardado de este cliente.');
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!subject || subject.length > MAX_EMAIL_SUBJECT_LENGTH || /[\r\n\x00-\x1f\x7f]/.test(subject)) invalid('Indica un asunto válido de hasta 160 caracteres.');
  if (!body || body.length > MAX_EMAIL_BODY_LENGTH || body.includes('\0')) invalid('Indica un mensaje de hasta 20,000 caracteres.');
  return { clientId, requestId: input.requestId, to, subject, body };
}
export const hashEmailValue = (value: string) => createHash('sha256').update(value).digest('hex');
export const emailFingerprint = (input: SendClientEmailRequest) => hashEmailValue(JSON.stringify([input.clientId, input.to, input.subject, input.body]));

// Tokens are encrypted at rest in a server-only collection, with the OAuth secret as key material.
export function encryptEmailToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}
export function decryptEmailToken(value: string, secret: string): string {
  const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
}

export function buildEmailMime(input: SendClientEmailRequest): string {
  // Short encoded-words keep Unicode subjects within RFC header line limits.
  const subjectChunks: string[] = [];
  let chunk = '';
  for (const char of input.subject) {
    if (Buffer.byteLength(chunk + char) > 36) { subjectChunks.push(chunk); chunk = ''; }
    chunk += char;
  }
  if (chunk) subjectChunks.push(chunk);
  const subject = subjectChunks.map(part => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
  const body = Buffer.from(input.body.replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  return Buffer.from([
    `From: Manglar <${MANGLAR_EMAIL_SENDER}>`, `To: <${input.to}>`, `Subject: ${subject}`,
    `Message-ID: <${input.requestId}@agenciamanglar.mx>`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body,
  ].join('\r\n')).toString('base64url');
}
