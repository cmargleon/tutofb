import { estimateManglarAction } from './estimates';
import { createHash, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ManglarAuthorization } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { oauthHash, opaqueValue } from '../automation/mcpOAuth.helpers';
import { DEFAULT_AUTOMATION_BUDGET } from '../../../shared/src/automationPolicy';
import type { Operation } from './registry';
import { operationSchema } from './registry';
import { validateSchema } from './schema';
import { authorizeOperation, findOperation } from './operations';
import { withManglarContext, type DelegatedCaller } from './context';
import { auditChanges, sanitizeResult } from './reads';
const canonical = (value: any): string => JSON.stringify(value && typeof value === 'object' ? (Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, JSON.parse(canonical(value[k]))]))) : value);
export const actionHash = (domain: string, action: string, data: unknown) => createHash('sha256').update(canonical({ domain, action, data })).digest('hex');
const idempotency = (key: unknown, caller: DelegatedCaller): string => {
    if (typeof key !== 'string' || !/^[\w:.-]{1,160}$/.test(key))
        throw new HttpsError('invalid-argument', 'Indica un idempotencyKey estable de 1 a 160 caracteres.');
    return oauthHash(`${caller.uid}:${key}`);
};
// Bind confirmations to the current documents as well as the exact payload. No free-form writes.
const targetVersions = async (operation: Operation, data: any): Promise<Record<string, string>> => {
    const db = getAppFirestore();
    const paths = new Set<string>();
    const visit = (value: any) => {
        if (!value || typeof value !== 'object')
            return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        for (const [key, entry] of Object.entries(value)) {
            if (typeof entry === 'string' && /^[\w-]{1,200}$/.test(entry)) {
                if (key === 'clientId')
                    paths.add(`clients/${entry}`);
                if (key === 'modelId')
                    paths.add(`models/${entry}`);
                if (key === 'batchId')
                    paths.add(`batches/${entry}`);
                if (key === 'jobId')
                    paths.add(`${operation.domain === 'automation' ? 'automationJobs' : 'jobs'}/${entry}`);
                if (key === 'uid')
                    paths.add(`users/${entry}`);
                if (key === 'id' && ['clients', 'models'].includes(operation.domain))
                    paths.add(`${operation.domain}/${entry}`);
            }
            if (typeof entry === 'object')
                visit(entry);
        }
    };
    visit(data);
    if (operation.domain === 'system')
        paths.add(operation.action === 'alerts' ? 'system_alert_settings/main' : 'system_config/main');
    if (operation.domain === 'finance' && operation.action === 'pricing')
        paths.add(`finance_client_pricing/${data.clientId}`);
    if (operation.domain === 'spreadsheets' && ['delete', 'selectCategory'].includes(operation.action))
        paths.add(`clients/${data.clientId}/spreadsheetTemplates/${data.templateId}`);
    if (operation.domain === 'finance' && operation.action === 'settings')
        paths.add('finance_settings/main');
    if (operation.domain === 'connections' && operation.action === 'setAccess')
        paths.add(`manglarAccess/${data.uid}`);
    if (operation.domain === 'connections' && operation.action === 'revoke')
        paths.add(`automationOAuth/grant-${oauthHash(data.connectionId)}`);
    if (data.draftId)
        paths.add(`manglarDrafts/${data.draftId}`);
    if (operation.domain === 'wizard' && ['classify', 'correct'].includes(operation.action))
        paths.add(`manglarDrafts/${data.id}`);
    if (paths.size > 100)
        throw new HttpsError('invalid-argument', 'Máximo 100 recursos por operación.');
    const snapshots = paths.size ? await db.getAll(...[...paths].map(path => db.doc(path))) : [];
    return Object.fromEntries(snapshots.map(snapshot => [snapshot.ref.path, snapshot.updateTime ? `${snapshot.updateTime.seconds}.${snapshot.updateTime.nanoseconds}` : 'missing']));
};
export interface PrepareActionInput {
    domain: string;
    action: string;
    data: Record<string, unknown>;
    idempotencyKey: string;
    budgetUsd?: number;
    allowEstimatedCosts?: boolean;
}
export const prepareAction = async (input: PrepareActionInput, caller: DelegatedCaller) => {
    const operation = findOperation(input.domain, input.action);
    validateSchema(input.data, operationSchema(operation));
    if (operation.risk === 'read')
        throw new HttpsError('invalid-argument', 'Las consultas se ejecutan directamente.');
    await authorizeOperation(operation, input.data, caller);
    const paid = operation.risk === 'paid';
    const max = (await getAppFirestore().collection('system_config').doc('main').get()).data()?.automationBudget?.maxBudgetUsd ?? DEFAULT_AUTOMATION_BUDGET.maxBudgetUsd;
    if (paid && (!Number.isFinite(input.budgetUsd) || input.budgetUsd! <= 0 || input.budgetUsd! > max || input.allowEstimatedCosts !== true))
        throw new HttpsError('failed-precondition', `Autoriza un presupuesto USD mayor que cero y hasta ${max}, con allowEstimatedCosts:true. Los costos son estimados.`);
    if (paid && operation.domain === 'automation') {
        const job = input.data.jobId ? (await getAppFirestore().collection('automationJobs').doc(String(input.data.jobId)).get()).data() : null;
        const plan = input.data.planId ? (await getAppFirestore().collection('automationPlans').doc(String(input.data.planId)).get()).data() : null;
        const required = input.data.budgetUsd ?? job?.budget?.limitUsd ?? plan?.policy?.budgetUsd;
        if (input.budgetUsd !== required)
            throw new HttpsError('failed-precondition', 'El presupuesto confirmado debe coincidir con el límite efectivo de la automatización.');
    }
    if (!paid && (input.budgetUsd !== undefined || input.allowEstimatedCosts !== undefined))
        throw new HttpsError('invalid-argument', 'Esta acción no necesita presupuesto.');
    const estimate = paid ? await estimateManglarAction(operation, input.data) : null;
    const hash = actionHash(input.domain, input.action, input.data);
    const id = idempotency(input.idempotencyKey, caller);
    const token = opaqueValue();
    const versions = await targetVersions(operation, input.data);
    const ref = getAppFirestore().collection('manglarOperations').doc(id);
    const existing = await ref.get();
    if (existing.exists) {
        if (existing.data()?.payloadHash !== hash)
            throw new HttpsError('already-exists', 'El idempotencyKey ya identifica otra operación.');
        return { operationId: id, state: existing.data()!.state, reused: true, confirmationToken: null, instruction: 'Usa el token de confirmación original. Si se perdió y no se ejecutó, prepara una nueva autorización.' };
    }
    await ref.create({ domain: input.domain, action: input.action, payloadHash: hash, ownerUid: caller.uid, connectionId: caller.connectionId, role: caller.role, accessVersion: caller.accessVersion,
        confirmationHash: oauthHash(token), state: 'prepared', createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60000), versions,
        budgetUsd: paid ? input.budgetUsd : 0, allowEstimatedCosts: paid, committedUsd: 0, risk: operation.risk, changes: auditChanges(input.data), estimate });
    return { operationId: id, confirmationToken: token, expiresInSeconds: 600, risk: operation.risk,
        estimate, review: { domain: input.domain, action: input.action, changes: auditChanges(input.data), resources: Object.keys(versions), budgetUsd: paid ? input.budgetUsd : null,
            costBasis: paid ? 'estimated_not_provider_confirmed' : null },
        instruction: paid ? 'Presenta la operación y su presupuesto y obtén autorización explícita antes de ejecutar. Usa confirmedBudgetUsd exactamente igual.' : 'Presenta los recursos y los cambios exactos y obtén confirmación antes de ejecutar.' };
};
export const executeOperation = async (operation: Operation, data: any, caller: DelegatedCaller, options: {
    idempotencyKey?: string;
    authorization?: ManglarAuthorization;
} = {}) => {
    validateSchema(data, operationSchema(operation));
    await authorizeOperation(operation, data, caller);
    const invoke = () => withManglarContext({ caller, authorize: () => authorizeOperation(operation, data, caller), ...(operation.risk === 'paid' ? { budgetId: options.authorization!.operationId } : {}) }, () => operation.run(data, caller));
    if (operation.risk === 'read')
        return sanitizeResult(await invoke());
    const needsConfirmation = ['paid', 'critical', 'destructive'].includes(operation.risk);
    if (needsConfirmation && !options.authorization)
        throw new HttpsError('failed-precondition', 'Prepara esta acción con manglar_prepare_action y confirma la operación exacta.');
    const id = needsConfirmation ? options.authorization!.operationId : idempotency(options.idempotencyKey, caller);
    if (!/^[a-f0-9]{64}$/.test(id))
        throw new HttpsError('invalid-argument', 'operationId inválido.');
    const db = getAppFirestore();
    const ref = db.collection('manglarOperations').doc(id);
    const hash = actionHash(operation.domain, operation.action, data);
    const versions = needsConfirmation ? await targetVersions(operation, data) : {};
    const claim = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const stored = snapshot.data();
        if (stored && (stored.ownerUid !== caller.uid || stored.connectionId !== caller.connectionId || stored.payloadHash !== hash))
            throw new HttpsError('permission-denied', 'La autorización no corresponde a esta conexión y estos cambios.');
        if (needsConfirmation) {
            if (!stored)
                throw new HttpsError('failed-precondition', 'Autorización no encontrada.');
            const provided = oauthHash(options.authorization!.confirmationToken || '');
            if (!timingSafeEqual(Buffer.from(provided), Buffer.from(stored.confirmationHash || '')))
                throw new HttpsError('permission-denied', 'Confirmación incorrecta.');
            if (operation.risk === 'paid' && options.authorization!.confirmedBudgetUsd !== stored.budgetUsd)
                throw new HttpsError('failed-precondition', 'Confirma exactamente el presupuesto preparado.');
        }
        if (stored?.state === 'completed')
            return { completed: true, result: stored.result };
        if (stored && stored.state !== 'prepared')
            throw new HttpsError('failed-precondition', 'La operación ya se inició. Consulta su estado; no se repetirá automáticamente si el resultado es incierto.');
        const currentTargets = needsConfirmation && Object.keys(stored!.versions).length ? await tx.getAll(...Object.keys(stored!.versions).map(path => db.doc(path))) : [];
        const currentVersions = Object.fromEntries(currentTargets.map(target => [target.ref.path, target.updateTime ? `${target.updateTime.seconds}.${target.updateTime.nanoseconds}` : 'missing']));
        if (needsConfirmation && canonical(stored!.versions) !== canonical(currentVersions))
            throw new HttpsError('failed-precondition', 'Los recursos cambiaron; prepara y revisa de nuevo.');
        if (needsConfirmation && (stored!.expiresAt.toMillis() <= Date.now() || canonical(stored!.versions) !== canonical(versions)))
            throw new HttpsError('failed-precondition', 'La autorización venció o los recursos cambiaron; prepara y revisa de nuevo.');
        if (!stored)
            tx.create(ref, { domain: operation.domain, action: operation.action, ownerUid: caller.uid, connectionId: caller.connectionId, payloadHash: hash, state: 'running', createdAt: FieldValue.serverTimestamp(), role: caller.role, accessVersion: caller.accessVersion, changes: auditChanges(data) });
        else
            tx.update(ref, { state: 'running', startedAt: FieldValue.serverTimestamp() });
        return { completed: false };
    });
    if (claim.completed)
        return claim.result;
    try {
        const result = sanitizeResult(await invoke());
        if (Buffer.byteLength(JSON.stringify(result)) > 500000)
            throw new HttpsError('resource-exhausted', 'Resultado demasiado grande para persistir; consulta el recurso creado.');
        await ref.update({ state: 'completed', result, completedAt: FieldValue.serverTimestamp() });
        return result;
    }
    catch (error) {
        await ref.update({ state: 'uncertain', error: { code: error instanceof HttpsError ? error.code : 'internal', message: 'La operación pudo iniciarse. Revisa sus recursos antes de crear otra autorización.' }, finishedAt: FieldValue.serverTimestamp() });
        throw error;
    }
};
export const readOperation = async (id: string, caller: DelegatedCaller) => {
    if (!/^[a-f0-9]{64}$/.test(id))
        throw new HttpsError('invalid-argument', 'operationId inválido.');
    const stored = (await getAppFirestore().collection('manglarOperations').doc(id).get()).data();
    if (!stored || stored.ownerUid !== caller.uid || stored.role !== caller.role || stored.accessVersion !== caller.accessVersion)
        throw new HttpsError('not-found', 'Operación no encontrada.');
    const { confirmationHash: _, connectionId: __, payloadHash: ___, versions: ____, ...safe } = stored;
    return sanitizeResult(safe);
};
