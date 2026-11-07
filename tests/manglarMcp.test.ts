import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-manglarmcp';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const helpers = require('../functions/lib/functions/src/automation/mcpOAuth.helpers.js');
const clientId = 'https://chatgpt.com/oauth/client.json';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 'test-verifier-'.repeat(5);
const metadata = async () => Response.json({ client_id: clientId, redirect_uris: [redirectUri], token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] });
const query = () => ({ client_id: clientId, redirect_uri: redirectUri, state: 'chatgpt-state', resource: helpers.MANGLAR_MCP_RESOURCE, response_type: 'code', code_challenge: helpers.pkceChallenge(verifier), code_challenge_method: 'S256', scope: 'jobs:read jobs:create' });

test('ChatGPT CIMD negotiates public-client PKCE even when its preferred method is private_key_jwt', async () => {
  const request = await helpers.parseAuthorization(query(), metadata);
  assert.equal(request.clientId, clientId);
  const callback = new URL(helpers.oauthRedirect(request, { code: 'test-code' }));
  assert.equal(callback.searchParams.get('state'), 'chatgpt-state');
  assert.equal(callback.searchParams.get('iss'), helpers.MANGLAR_ORIGIN);
});
test('OAuth rejects SSRF, open redirects, duplicate parameters, wrong resources and missing PKCE before any request', async () => {
  let requests = 0;
  const noNetwork = async () => { requests++; throw new Error('must not fetch'); };
  for (const patch of [{ client_id: 'https://evil.test/oauth/client.json' }, { client_id: `${clientId}?leak=1` }, { redirect_uri: `${redirectUri}.evil.test` }, { client_id: [clientId, clientId] }, { code_challenge_method: 'plain' }, { resource: 'https://evil.test/mcp' }, { scope: 'jobs:retry' }, { state: ['duplicate', 'state'] }]) {
    await assert.rejects(() => helpers.parseAuthorization({ ...query(), ...patch }, noNetwork));
  }
  assert.equal(requests, 0);
  await assert.rejects(() => helpers.validateChatGPTClient(clientId, redirectUri, async () => Response.json({ client_id: clientId, redirect_uris: ['https://chatgpt.com/connector/oauth/other'] })));
  await assert.rejects(() => helpers.validateChatGPTClient(clientId, redirectUri, async () => Response.json({ client_id: clientId, redirect_uris: [redirectUri], token_endpoint_auth_method: 'private_key_jwt' })));
});

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
test('Manglar OAuth and MCP authorization against emulators', { skip: !enabled }, async (t) => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(127\.0\.0\.1|localhost):/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST!, /^(127\.0\.0\.1|localhost):/);
  const admin = require('../functions/node_modules/firebase-admin');
  const projectId = 'demo-manglar-automation';
  process.env.GCLOUD_PROJECT = projectId;
  admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore(); const { Timestamp } = admin.firestore;
  const oauth = require('../functions/lib/functions/src/automation/mcpOAuth.js');
  const mcp = require('../functions/lib/functions/src/automation/mcp.js');
  const principalRef = db.collection('automationPrincipals').doc('chatgpt-work');
  const uid = 'mcp-admin'; const otherUid = 'mcp-other-admin';
  await db.collection('users').doc(uid).set({ role: 'admin', active: true });
  await db.collection('users').doc(otherUid).set({ role: 'admin', active: true });
  await db.collection('manglarAccess').doc(uid).set({ enabled: true, clientIds: ['mcp-client'], version: 1 });
  await db.collection('clients').doc('mcp-client').set({ name: 'MCP Client', status: 'active', automation: { enabled: true, driveFolderIds: ['mcp-folder'] } });
  await principalRef.set({ active: true, version: 1, allowedClientIds: ['mcp-client'], allowedJobTypes: ['garment', 'product'], scopes: ['jobs:read', 'jobs:create'], secretHashes: [] });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) => String(url) === clientId ? metadata() : nativeFetch(url, options)) as typeof fetch;
  const pending = async (scopes = 'jobs:read jobs:create') => {
    const redirect = new URL(await oauth.beginManglarAuthorization({ ...query(), scope: scopes }));
    return redirect.searchParams.get('request');
  };
  const connect = async (scopes?: string) => {
    const requestId = await pending(scopes);
    const { redirectUrl } = await oauth.decideManglarAuthorization({ requestId, approve: true }, uid);
    const code = new URL(redirectUrl).searchParams.get('code');
    const body = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, resource: helpers.MANGLAR_MCP_RESOURCE, code, code_verifier: verifier };
    return { body, tokens: await oauth.exchangeManglarToken(body) };
  };
  const http = async (method: string, path: string, body?: any, authorization?: string, origin?: string) => {
    let status = 200; let data: any; const headers: Record<string, string> = {};
    const response = { set: (key: string, value: string) => { headers[key] = value; return response; }, status: (value: number) => { status = value; return response; }, json: (value: any) => { data = value; return response; }, end: () => response, redirect: (value: number, url: string) => { status = value; data = url; return response; } };
    await mcp.manglarMcpHandler({ method, path, body, query: {}, headers: { authorization, origin }, is: (type: string) => type === 'application/json', rawBody: Buffer.from(JSON.stringify(body ?? {})) }, response);
    return { status, data, headers };
  };
  const call = (name: string, args = {}, token?: string) => http('POST', '/api/manglar/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token ? `Bearer ${token}` : undefined);
  try {
    await t.test('metadata and discovery reveal tools, never customer data; calls require OAuth and reject foreign origins', async () => {
      const resource = await http('GET', '/.well-known/oauth-protected-resource/api/manglar/mcp');
      assert.equal(resource.data.resource, helpers.MANGLAR_MCP_RESOURCE);
      const server = await http('GET', '/.well-known/oauth-authorization-server');
      assert.deepEqual(server.data.code_challenge_methods_supported, ['S256']);
      assert.equal(server.data.authorization_response_iss_parameter_supported, true);
      const initialize = await http('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'test', version: '1' }, capabilities: {} } });
      assert.equal(initialize.data.result.protocolVersion, '2025-06-18');
      const list = await http('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      assert.ok(list.data.result.tools.length > 7);
      for (const name of ['manglar_capabilities','manglar_prepare_plan','manglar_execute_plan','manglar_get_job']) assert.ok(list.data.result.tools.some((tool:any)=>tool.name===name));
      assert.equal(JSON.stringify(list.data).includes('MCP Client'), false);
      assert.equal((await http('GET', '/mcp')).status, 405);
      assert.equal((await http('POST', '/mcp', [], undefined, 'https://evil.test')).status, 403);
      const missing = await call('manglar_capabilities');
      assert.equal(missing.status, 401); assert.ok(missing.headers['WWW-Authenticate']);
      assert.ok(missing.data.result._meta['mcp/www_authenticate']);
      assert.equal((await call('manglar_capabilities', {}, 'manglar_at_' + 'a'.repeat(43))).status, 401);
    });
    await t.test('only current active admins can authorize; denial preserves state and issuer without issuing a code', async () => {
      const requestId = await pending();
      await db.collection('users').doc(uid).update({ role: 'operador' });
      await db.collection('manglarAccess').doc(uid).update({ enabled:false });
      await assert.rejects(() => oauth.manglarConnectionDetails(requestId, uid), { code: 'permission-denied' });
      await assert.rejects(() => oauth.decideManglarAuthorization({ requestId, approve: true }, uid), { code: 'permission-denied' });
      await db.collection('users').doc(uid).update({ role: 'admin' });
      await db.collection('manglarAccess').doc(uid).update({ enabled:true });
      const details = await oauth.manglarConnectionDetails(requestId, uid);
      assert.deepEqual(details.clients, [{ id: 'mcp-client', name: 'MCP Client' }]);
      const denied = new URL((await oauth.decideManglarAuthorization({ requestId, approve: false }, uid)).redirectUrl);
      assert.equal(denied.searchParams.get('error'), 'access_denied');
      assert.equal(denied.searchParams.get('state'), query().state);
      assert.equal(denied.searchParams.get('iss'), helpers.MANGLAR_ORIGIN);
      assert.equal(denied.searchParams.has('code'), false);
      await assert.rejects(() => oauth.decideManglarAuthorization({ requestId, approve: true }, uid));
    });
    await t.test('stale consent clients cannot silently approve the expanded user permissions',async()=>{
      const requestId=await pending();
      await assert.rejects(()=>oauth.decideManglarConnection.run({data:{requestId,approve:true},auth:{uid,token:{role:'admin'}}}),{code:'failed-precondition'});
      const approved=await oauth.decideManglarConnection.run({data:{requestId,approve:true,authorizationModel:'user-v1'},auth:{uid,token:{role:'admin'}}});
      assert.ok(new URL(approved.redirectUrl).searchParams.get('code'));
    });
    await t.test('code exchange requires PKCE, exact client, callback and audience; raw tokens never persist', async () => {
      const { body, tokens } = await connect();
      await assert.rejects(() => oauth.exchangeManglarToken(body), { oauthCode: 'invalid_grant' });
      await assert.rejects(() => oauth.exchangeManglarToken({ ...body, resource: 'https://evil.test' }), { oauthCode: 'invalid_target' });
      const requestId = await pending();
      const { redirectUrl } = await oauth.decideManglarAuthorization({ requestId, approve: true }, uid);
      const unusedBody = { ...body, code: new URL(redirectUrl).searchParams.get('code') };
      await assert.rejects(() => oauth.exchangeManglarToken({ ...unusedBody, code_verifier: 'x'.repeat(43) }), { oauthCode: 'invalid_grant' });
      await assert.rejects(() => oauth.exchangeManglarToken({ ...unusedBody, redirect_uri: 'https://chatgpt.com/connector/oauth/other' }), { oauthCode: 'invalid_grant' });
      await assert.rejects(() => oauth.exchangeManglarToken({ ...unusedBody, client_id: 'https://evil.test' }), { oauthCode: 'invalid_client' });
      const results = await Promise.allSettled([oauth.exchangeManglarToken(unusedBody), oauth.exchangeManglarToken(unusedBody)]);
      assert.equal(results.filter((result: any) => result.status === 'fulfilled').length, 1);
      const records = JSON.stringify((await db.collection('automationOAuth').get()).docs.map((doc: any) => doc.data()));
      assert.equal(records.includes(tokens.access_token), false); assert.equal(records.includes(tokens.refresh_token), false);
      const capabilities = await call('manglar_capabilities', {}, tokens.access_token);
      assert.equal(capabilities.status, 200); assert.equal(capabilities.data.result.structuredContent.clients[0].clientId, 'mcp-client');
    });
    await t.test('refresh rotates credentials, rejects escalation and revokes the family on reuse', async () => {
      const { tokens } = await connect('jobs:read');
      const body = { grant_type: 'refresh_token', client_id: clientId, resource: helpers.MANGLAR_MCP_RESOURCE, refresh_token: tokens.refresh_token };
      await assert.rejects(() => oauth.exchangeManglarToken({ ...body, scope: 'jobs:read jobs:create' }), { oauthCode: 'invalid_scope' });
      const next = await oauth.exchangeManglarToken(body);
      assert.notEqual(next.refresh_token, tokens.refresh_token);
      assert.equal((await call('manglar_capabilities', {}, next.access_token)).status, 200);
      await assert.rejects(() => oauth.exchangeManglarToken(body), { oauthCode: 'invalid_grant' });
      assert.equal((await call('manglar_capabilities', {}, next.access_token)).status, 401);
    });
    await t.test('scopes and clients are enforced before a plan, model read or generation; budgets must match', async () => {
      const { tokens } = await connect('jobs:read');
      const caller = await oauth.verifyManglarMcpToken(`Bearer ${tokens.access_token}`);
      await assert.rejects(() => mcp.executeManglarTool('manglar_prepare_plan', { request: { clientId: 'mcp-client', jobType: 'product' } }, caller), { code: 'permission-denied' });
      await assert.rejects(() => mcp.executeManglarTool('manglar_list_drive_files', { clientId: 'foreign', folderId: 'mcp-folder' }, caller), { code: 'permission-denied' });
      await assert.rejects(() => mcp.executeManglarTool('manglar_list_models', { clientId: 'foreign' }, caller), { code: 'permission-denied' });
      const full = await connect(); const creator = await oauth.verifyManglarMcpToken(`Bearer ${full.tokens.access_token}`);
      const planId = 'a'.repeat(64);
      await db.collection('automationPlans').doc(planId).set({ id: planId, createdByUid: creator.uid, clientId: 'mcp-client', request: { clientId: 'mcp-client', jobType: 'product' }, policy: { budgetUsd: 5, allowEstimatedCosts: false }, executedJobId: null });
      await assert.rejects(() => mcp.executeManglarTool('manglar_execute_plan', { planId, confirmedBudgetUsd: 100 }, creator), { code: 'failed-precondition' });
      await assert.rejects(() => mcp.executeManglarTool('manglar_execute_plan', { planId, confirmedBudgetUsd: 5 }, creator), { code: 'failed-precondition' });
      assert.equal((await db.collection('automationJobs').where('planId', '==', planId).get()).size, 0);
    });
    await t.test('owner-only revocation, admin demotion, principal changes and expiration immediately stop access', async () => {
      const { tokens } = await connect();
      const list = await oauth.listManglarConnections.run({ data: {}, auth: { uid, token: { role: 'admin' } } });
      const connection = list.connections.find((entry: any) => entry.active);
      await assert.rejects(() => oauth.revokeManglarConnection.run({ data: { connectionId: connection.id }, auth: { uid: otherUid, token: { role: 'admin' } } }), { code: 'not-found' });
      // Locate the specific grant for this token, rather than revoking a different test connection.
      const accessRef = db.collection('automationOAuth').doc(`access-${helpers.oauthHash(tokens.access_token)}`);
      const grantId = (await accessRef.get()).data().grantId;
      await oauth.revokeManglarConnection.run({ data: { connectionId: grantId }, auth: { uid, token: { role: 'admin' } } });
      await assert.rejects(() => oauth.verifyManglarMcpToken(`Bearer ${tokens.access_token}`), { code: 'unauthenticated' });
      const next = await connect();
      await db.collection('users').doc(uid).update({ role: 'operador' });
      await assert.rejects(() => oauth.verifyManglarMcpToken(`Bearer ${next.tokens.access_token}`), { code: 'unauthenticated' });
      await db.collection('users').doc(uid).update({ role: 'admin' });
      const independent = await connect();
      await principalRef.update({ version: 2 });
      assert.equal((await oauth.verifyManglarMcpToken(`Bearer ${independent.tokens.access_token}`)).uid, uid);
      await db.collection('manglarAccess').doc(uid).update({ version: 2 });
      await assert.rejects(() => oauth.verifyManglarMcpToken(`Bearer ${independent.tokens.access_token}`), { code: 'unauthenticated' });
      const expired = await connect();
      await db.collection('automationOAuth').doc(`access-${helpers.oauthHash(expired.tokens.access_token)}`).update({ expiresAt: Timestamp.fromMillis(0) });
      await assert.rejects(() => oauth.verifyManglarMcpToken(`Bearer ${expired.tokens.access_token}`), { code: 'unauthenticated' });
    });
    await t.test('Firestore client rules deny reads of all OAuth records even to an authenticated user', async () => {
      const response = await nativeFetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `mcp-rules-${Date.now()}@example.test`, password: 'emulator-password', returnSecureToken: true }) });
      const { idToken } = await response.json() as any;
      assert.ok(idToken);
      const record = (await db.collection('automationOAuth').limit(1).get()).docs[0].id;
      const read = await nativeFetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/automationOAuth/${record}`, { headers: { Authorization: `Bearer ${idToken}` } });
      assert.equal(read.status, 403);
    });
  } finally { globalThis.fetch = nativeFetch; await cleanupEmulatorDatabase(db); await db.terminate(); await admin.app().delete(); }
});
