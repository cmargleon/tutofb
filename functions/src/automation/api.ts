import { getAutomationCapabilities, readAutomationJobStatus } from './queries';
import { prepareAutomationPlan, readAutomationPlan, publicAutomationPlan, executeAutomationPlan, listAuthorizedDriveFiles } from './plans';
import { resumeAutomation } from './recovery';
import { automationResultsZip } from './results';
import type { ResumeAutomationRequest } from '../../../shared/src/types';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { HttpsError, onCall, onRequest, Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { AutomationJob, CreateAutomationJobRequest, AutomationJobReceipt, RetryAutomationJobRequest } from '../../../shared/src/types';
import { assertCallableRoles, assertUserRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { canReadAutomation } from './domain';
import { createAutomation, retryAutomation } from './persistence';
import { automationPolling } from './polling';
import { normalizeInputImage } from './imports';
import { MachineCaller, assertMachineClient, assertMachineScope, issueMachineToken, verifyMachineToken } from './machineAuth';

export const authenticateAutomation = async (
  authorization: string | undefined,
  verify: (token: string) => Promise<{ uid: string }> = (token) => admin.auth().verifyIdToken(token, true),
): Promise<{ uid: string; role: 'admin' | 'operador' | 'revisor' } | MachineCaller> => {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) throw new HttpsError('unauthenticated', 'Se requiere un Firebase ID token.');
  if (match[1].startsWith('manglar_at_')) return verifyMachineToken(match[1]);
  let uid: string;
  try { ({ uid } = await verify(match[1])); } catch { throw new HttpsError('unauthenticated', 'Token inválido o expirado.'); }
  const role = await assertUserRoles(uid, undefined, ['admin', 'operador']);
  return { uid, role };
};
export const createAutomationJob = onCall<CreateAutomationJobRequest, Promise<AutomationJobReceipt>>(async (request) => {
  const role = await assertCallableRoles(request, ['admin', 'operador']);
  return createAutomation(request.data, request.auth!.uid, role);
});
export const retryAutomationJob = onCall<RetryAutomationJobRequest, Promise<AutomationJobReceipt>>(async (request) => {
  const role = await assertCallableRoles(request, ['admin', 'operador']);
  return retryAutomation(request.data, request.auth!.uid, role);
});

export const createAutomationPlan = onCall<CreateAutomationJobRequest>(async (request) => {
  const role = await assertCallableRoles(request, ['admin', 'operador']);
  return publicAutomationPlan(await prepareAutomationPlan(request.data, request.auth!.uid, role));
});
export const getAutomationPlan = onCall<{ planId: string }>(async (request) => {
  const role = await assertCallableRoles(request, ['admin', 'operador']);
  if (!/^[a-f0-9]{64}$/.test(request.data.planId)) throw new HttpsError('invalid-argument', 'Plan inválido.');
  return publicAutomationPlan(await readAutomationPlan(request.data.planId, request.auth!.uid, role));
});
export const executeAutomationPlanCallable = onCall<{ planId: string }>(async (request) => {
  const role = await assertCallableRoles(request, ['admin', 'operador']);
  if (!/^[a-f0-9]{64}$/.test(request.data.planId)) throw new HttpsError('invalid-argument', 'Plan inválido.');
  return executeAutomationPlan(request.data.planId, request.auth!.uid, role);
});
export const resumeAutomationJob = onCall<ResumeAutomationRequest>(async (request) => {
  const role = await assertCallableRoles(request, ['admin', 'operador']);
  return resumeAutomation(request.data, request.auth!.uid, role);
});

export const automationHttpHandler = async (request: Request, response: Response): Promise<void> => {
  response.set('Cache-Control', 'no-store');
  try {
    const path = request.path.replace(/^\/api\/automation/, '').replace(/\/$/, '');
    if (request.method === 'POST' && path === '/token') {
      response.set('Pragma', 'no-cache');
      const body = request.body;
      if (body?.grant_type !== 'client_credentials') { response.status(400).json({ error: 'unsupported_grant_type' }); return; }
      let clientId = body.client_id;
      let clientSecret = body.client_secret;
      if (request.headers.authorization?.startsWith('Basic ')) {
        const decoded = Buffer.from(request.headers.authorization.slice(6), 'base64').toString('utf8');
        const colon = decoded.indexOf(':');
        clientId = decodeURIComponent(decoded.slice(0, colon));
        clientSecret = decodeURIComponent(decoded.slice(colon + 1));
      }
      try { response.json(await issueMachineToken(clientId, clientSecret, body.scope)); }
      catch (error) {
        const known = error instanceof HttpsError;
        const limited = known && error.code === 'resource-exhausted';
        response.status(limited ? 429 : known && error.code === 'invalid-argument' ? 400 : 401).json({ error: limited ? 'temporarily_unavailable' : known && error.code === 'invalid-argument' ? 'invalid_scope' : 'invalid_client' });
      }
      return;
    }
    const caller = await authenticateAutomation(request.headers.authorization);
    const machine = caller.role === 'automation' ? caller : null;
    if (request.method === 'GET' && path === '/capabilities') {
      if (machine) assertMachineScope(machine, 'jobs:read');
      response.json(await getAutomationCapabilities(machine)); return;
    }
    if (request.method === 'POST' && path === '/plans') {
      if (machine) { assertMachineScope(machine, 'jobs:create'); assertMachineClient(machine.principal, request.body?.clientId, request.body?.jobType); }
      response.status(200).json(publicAutomationPlan(await prepareAutomationPlan(request.body, caller.uid, caller.role))); return;
    }
    const planMatch = path.match(/^\/plans\/([a-f0-9]{64})(\/execute)?$/);
    if (planMatch) {
      if (machine) assertMachineScope(machine, planMatch[2] ? 'jobs:create' : 'jobs:read');
      if (request.method === 'POST' && planMatch[2]) response.status(202).json(await executeAutomationPlan(planMatch[1], caller.uid, caller.role));
      else if (request.method === 'GET' && !planMatch[2]) {
        const plan = await readAutomationPlan(planMatch[1], caller.uid, caller.role);
        response.json({ ...publicAutomationPlan(plan), ...(request.query?.includePrompts === 'true' ? { prompt: plan.preset.prompt, scenes: plan.preset.scenes } : {}) });
      }
      else response.status(405).json({ error: { code: 'method-not-allowed' } });
      return;
    }
    const driveMatch = path.match(/^\/clients\/([\w-]{1,200})\/drive\/([A-Za-z0-9_-]{1,200})$/);
    if (request.method === 'GET' && driveMatch) {
      if (machine) { assertMachineScope(machine, 'jobs:read'); if (!machine.principal.allowedClientIds.includes(driveMatch[1])) throw new HttpsError('permission-denied', 'Cliente no autorizado.'); }
      response.json(await listAuthorizedDriveFiles(driveMatch[1], driveMatch[2])); return;
    }
    if (request.method === 'POST' && path === '/uploads') {
      if (machine) assertMachineScope(machine, 'uploads:write');
      if (!request.is('image/*')) throw new HttpsError('invalid-argument', 'Envía bytes de imagen con Content-Type image/*.');
      const bytes = await normalizeInputImage(request.rawBody);
      const storagePath = `garments/drafts/${caller.uid}/${randomUUID()}/upload/image.jpg`;
      await admin.storage().bucket().file(storagePath).save(bytes, { resumable: false, metadata: { contentType: 'image/jpeg' } });
      response.status(201).json({ storagePath }); return;
    }
    if (request.method === 'POST' && path === '/jobs') {
      if (machine) {
        assertMachineScope(machine, 'jobs:create');
        assertMachineClient(machine.principal, request.body?.clientId, request.body?.jobType);
      }
      const receipt = await createAutomation(request.body, caller.uid, caller.role);
      const job = (await getAppFirestore().collection('automationJobs').doc(receipt.jobId).get()).data() as AutomationJob;
      response.status(receipt.duplicate ? 200 : 202).json({ ...receipt, ...automationPolling(job) }); return;
    }
    const match = path.match(/^\/jobs\/([\w-]{1,200})(\/(?:retry|resume|download))?$/);
    if (!match) { response.status(404).json({ error: { code: 'not-found', message: 'Endpoint no encontrado.' } }); return; }
    const snapshot = await getAppFirestore().collection('automationJobs').doc(match[1]).get();
    const stored = snapshot.data() as AutomationJob | undefined;
    if (!stored || !canReadAutomation(stored, caller.uid, caller.role)) throw new HttpsError('not-found', 'Trabajo no encontrado.');
    if (machine) assertMachineClient(machine.principal, stored.clientId, stored.jobType);
    if (request.method === 'POST' && match[2] === '/resume') {
      if (machine) assertMachineScope(machine, 'jobs:retry');
      response.json(await resumeAutomation({ ...request.body, jobId: match[1] }, caller.uid, caller.role)); return;
    }
    if (request.method === 'GET' && match[2] === '/download') {
      if (machine) assertMachineScope(machine, 'jobs:read');
      response.set('Content-Type', 'application/zip'); response.set('Content-Disposition', `attachment; filename="automation-${match[1]}.zip"`);
      response.send(await automationResultsZip(stored)); return;
    }
    if (request.method === 'POST' && match[2] === '/retry') {
      if (machine) assertMachineScope(machine, 'jobs:retry');
      response.json(await retryAutomation({ ...request.body, jobId: match[1] }, caller.uid, caller.role)); return;
    }
    if (request.method !== 'GET' || match[2]) { response.status(405).json({ error: { code: 'method-not-allowed' } }); return; }
    if (machine) assertMachineScope(machine, 'jobs:read');
    response.json(await readAutomationJobStatus(match[1], caller));
  } catch (error) {
    const known = error instanceof HttpsError;
    const code = known ? error.code : 'internal';
    const status = ({ unauthenticated: 401, 'permission-denied': 403, 'not-found': 404, 'invalid-argument': 400, 'already-exists': 409, 'failed-precondition': 409, 'resource-exhausted': 429 } as Record<string, number>)[code] || 500;
    response.status(status).json({ error: { code, message: known ? error.message : 'No se pudo completar la solicitud.' } });
  }
};
export const automationApi = onRequest({ timeoutSeconds: 60, memory: '512MiB', maxInstances: 10, concurrency: 1, cors: ['https://tutofb-260320-1003.web.app', 'https://tutofb-260320-1003.firebaseapp.com', /^http:\/\/(localhost|127\.0\.0\.1):3000$/] }, automationHttpHandler);
