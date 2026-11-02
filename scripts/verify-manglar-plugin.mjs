#!/usr/bin/env node
// Production discovery and authentication smoke checks. No credentials or paid operations.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const origin = 'https://tutofb-260320-1003.web.app';
const resource = `${origin}/api/manglar/mcp`;
// These checks never execute a production plan; retry only transient transport failures.
const probeFetch = async (url, options = {}) => {
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(url, { ...options, signal: AbortSignal.timeout(60000) }); }
    catch (error) {
      if (attempt >= 2 || !['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT'].includes(error.cause?.code)) throw error;
    }
  }
};
const get = (path, options = {}) => probeFetch(`${origin}${path}`, options);
const rpc = (method, params = {}) => get('/api/manglar/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
const metadata = await get('/.well-known/oauth-protected-resource/api/manglar/mcp');
assert.equal(metadata.status, 200);
const protectedResource = await metadata.json();
assert.equal(protectedResource.resource, resource);
assert.deepEqual(protectedResource.authorization_servers, [origin]);
const discovery = await get('/.well-known/oauth-authorization-server');
assert.equal(discovery.status, 200);
const auth = await discovery.json();
assert.equal(auth.issuer, origin);
assert.equal(auth.authorization_response_iss_parameter_supported, true);
assert.equal(auth.client_id_metadata_document_supported, true);
assert.deepEqual(auth.code_challenge_methods_supported, ['S256']);
const initialized = await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'manglar-production-verification', version: '1.0.0' }, capabilities: {} });
assert.equal(initialized.status, 200);
assert.equal((await initialized.json()).result.serverInfo.name, 'manglar');
const list = await rpc('tools/list');
assert.equal(list.status, 200);
const tools = (await list.json()).result.tools;
assert.equal(tools.length, 7);
assert.ok(tools.every((tool) => tool.securitySchemes[0].type === 'oauth2'));
assert.equal(tools.find((tool) => tool.name === 'manglar_execute_plan').annotations.readOnlyHint, false);
const unauthorized = await rpc('tools/call', { name: 'manglar_capabilities', arguments: {} });
assert.equal(unauthorized.status, 401);
assert.ok(unauthorized.headers.get('www-authenticate')?.includes('oauth-protected-resource'));
await unauthorized.arrayBuffer();
const invalidToken = await get('/api/manglar/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'https://chatgpt.com/oauth/client.json', code: 'invalid', resource }) });
assert.equal(invalidToken.status, 400);
await invalidToken.arrayBuffer();
const verifier = randomBytes(32).toString('base64url');
const authorizationQuery = new URLSearchParams({ client_id: 'https://chatgpt.com/oauth/client.json', redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', response_type: 'code', state: randomBytes(24).toString('base64url'), scope: 'jobs:read jobs:create', resource, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
const authorize = await get(`/api/manglar/oauth/authorize?${authorizationQuery}`, { redirect: 'manual' });
assert.equal(authorize.status, 303);
const consentUrl = new URL(authorize.headers.get('location'));
assert.equal(consentUrl.origin, origin);
assert.equal(consentUrl.pathname, '/automation/connect');
assert.match(consentUrl.searchParams.get('request'), /^[A-Za-z0-9_-]{43}$/);
await authorize.arrayBuffer();
const consent = await probeFetch(consentUrl);
assert.equal(consent.status, 200);
assert.equal(consent.headers.get('referrer-policy'), 'no-referrer');
assert.match(consent.headers.get('cache-control'), /no-store/);
await consent.arrayBuffer();
const deniedCallable = await probeFetch('https://us-central1-tutofb-260320-1003.cloudfunctions.net/decideManglarConnection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { requestId: consentUrl.searchParams.get('request'), approve: true } }) });
assert.equal(deniedCallable.status, 401);
await deniedCallable.arrayBuffer();
const report = { checkedAt: new Date().toISOString(), resource, discoveryPassed: true, protocolInitializationPassed: true,
  tools: tools.map((tool) => tool.name), anonymousCallsRejected: true, invalidTokenExchangeRejected: true,
  realChatGPTMetadataVerified: true, consentPageServed: true, anonymousConsentRejected: true,
  nativeChatGPTLinkCompleted: false, pending: 'User must add the private MCP plugin and sign in to authorize it in ChatGPT.', paidGeneration: false, credentialsPrinted: false };
await writeFile(new URL('../docs/MANGLAR_PLUGIN_VERIFICATION.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
