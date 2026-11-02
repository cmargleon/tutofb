import { createHash, randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';

export const MANGLAR_ORIGIN = 'https://tutofb-260320-1003.web.app';
export const MANGLAR_MCP_RESOURCE = `${MANGLAR_ORIGIN}/api/manglar/mcp`;
export const MANGLAR_MCP_SCOPES = ['jobs:read', 'jobs:create'] as const;
export const oauthHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const opaqueValue = (): string => randomBytes(32).toString('base64url');
export const pkceChallenge = (value: string): string => createHash('sha256').update(value).digest('base64url');
export class OAuthError extends Error {
  constructor(public readonly oauthCode: string, message: string, public readonly status = 400) { super(message); }
}
export const requireOAuthString = (value: unknown, max = 2048): string => {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new OAuthError('invalid_request', 'Parámetro OAuth inválido.');
  return value;
};
export const validateRequestId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpsError('invalid-argument', 'Solicitud de conexión inválida.');
  return value;
};
export const parseOAuthScopes = (value: unknown): string[] => {
  const scopes = value === undefined ? [...MANGLAR_MCP_SCOPES] : [...new Set(requireOAuthString(value, 200).split(' ').filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !(MANGLAR_MCP_SCOPES as readonly string[]).includes(scope))) throw new OAuthError('invalid_scope', 'Permisos no admitidos.');
  return scopes;
};
export interface OAuthAuthorization {
  clientId: string; redirectUri: string; state: string; challenge: string; resource: string; scopes: string[];
}
// Fetch only OpenAI's fixed metadata endpoints. No arbitrary URL, redirect, or SSRF.
export const validateChatGPTClient = async (clientId: string, redirectUri: string, fetchClient: typeof fetch = fetch): Promise<void> => {
  if (!/^https:\/\/chatgpt\.com\/oauth\/(?:[A-Za-z0-9_-]{1,200}\/)?client\.json$/.test(clientId)) throw new OAuthError('invalid_client', 'Cliente OAuth no admitido.');
  if (!/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]{1,200})$/.test(redirectUri)) throw new OAuthError('invalid_request', 'Callback no admitido.');
  const response = await fetchClient(clientId, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new OAuthError('invalid_client', 'No se pudo verificar la identidad de ChatGPT.');
  const text = await response.text();
  if (text.length > 32768) throw new OAuthError('invalid_client', 'Metadatos OAuth inválidos.');
  let data: { client_id?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown; token_endpoint_auth_methods_supported?: unknown };
  try { data = JSON.parse(text); } catch { throw new OAuthError('invalid_client', 'Metadatos OAuth inválidos.'); }
  const methods = Array.isArray(data.token_endpoint_auth_methods_supported) ? data.token_endpoint_auth_methods_supported : [data.token_endpoint_auth_method ?? 'none'];
  if (data.client_id !== clientId || !Array.isArray(data.redirect_uris) || !data.redirect_uris.includes(redirectUri)
    || !methods.includes('none')) throw new OAuthError('invalid_client', 'El callback o la autenticación no corresponden al cliente de ChatGPT.');
};
export const parseAuthorization = async (query: Record<string, unknown>, fetchClient: typeof fetch = fetch): Promise<OAuthAuthorization> => {
  if (query.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'Se requiere authorization_code.');
  if (query.resource !== MANGLAR_MCP_RESOURCE) throw new OAuthError('invalid_target', 'Recurso OAuth inválido.');
  if (query.code_challenge_method !== 'S256' || typeof query.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge)) throw new OAuthError('invalid_request', 'Se requiere PKCE S256.');
  const clientId = requireOAuthString(query.client_id);
  const redirectUri = requireOAuthString(query.redirect_uri);
  const state = requireOAuthString(query.state);
  const scopes = parseOAuthScopes(query.scope);
  await validateChatGPTClient(clientId, redirectUri, fetchClient);
  return { clientId, redirectUri, state, challenge: query.code_challenge, resource: MANGLAR_MCP_RESOURCE, scopes };
};
export const oauthRedirect = (request: OAuthAuthorization, values: Record<string, string>): string => {
  const url = new URL(request.redirectUri);
  url.searchParams.set('state', request.state);
  url.searchParams.set('iss', MANGLAR_ORIGIN);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.href;
};
