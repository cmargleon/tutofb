import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { FieldPath, type Query } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ManglarQueryRequest } from '../../../shared/src/types';
import { isPoseActive } from '../../../shared/src/domain';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertClientAccess, assertResourceAccess, requireUnrestrictedAdmin, validId } from './access';
import type { DelegatedCaller } from './context';
export const sanitizeResult = (value: unknown): any => {
    if (value === undefined)
        return null;
    if (value === null || typeof value !== 'object')
        return value;
    if (value instanceof Date) return value.toISOString();
    if ('toDate' in value && typeof value.toDate === 'function')
        return value.toDate().toISOString();
    if (Array.isArray(value))
        return value.map(sanitizeResult);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:(?:openai|gemini|google|firebase)[_-]?)?(?:password|clientSecret|secret(?:s|Hashes)?|api[_-]?key|fal[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|claimToken|leaseToken)$/i.test(key)).map(([key, entry]) => [key, sanitizeResult(entry)]));
};
// Keep audit documents below Firestore's document limit without dropping resource IDs.
// The execution layer separately binds the complete, unabridged input with actionHash.
export const auditChanges = (input:unknown):unknown => {
    const safe=sanitizeResult(input);
    if(Buffer.byteLength(JSON.stringify(safe))<=160000)return safe;
    const summarize=(value:any):any=>{
        if(typeof value==='string'&&value.length>256)return {characters:value.length,sha256:createHash('sha256').update(value).digest('hex'),preview:value.slice(0,160)};
        if(Array.isArray(value))return value.map(summarize);
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,summarize(entry)]));
        return value;
    };
    const summarized=summarize(safe);
    if(Buffer.byteLength(JSON.stringify(summarized))<=160000)return {summarized:true,data:summarized};
    return {summarized:true,sha256:createHash('sha256').update(JSON.stringify(safe)).digest('hex'),fields:Object.keys(safe||{}),note:'Recursos y argumentos exactos vinculados al payloadHash de la operación.'};
};
const compact = ['id', 'uid', 'name', 'email', 'displayName', 'role', 'active', 'status', 'clientId', 'clientNameSnapshot', 'modelId', 'modelNameSnapshot', 'batchId', 'jobId', 'garmentId', 'garmentName', 'poseImageId', 'poseFileName', 'provider', 'generationKind', 'createdByUid', 'createdAt', 'updatedAt', 'totalJobs', 'pendingJobs', 'processingJobs', 'completedJobs', 'failedJobs', 'completedOutputCount', 'totalCostUsd', 'estimatedCostUsd', 'lastError', 'failureInfo', 'progress', 'error', 'budget', 'spendingPaused', 'date', 'period', 'total', 'completed', 'failed', 'count', 'costUsd', 'type', 'description', 'amount', 'currency', 'resultImagePath', 'verdict'];
const project = (row: Record<string, unknown>, data: ManglarQueryRequest, summary = false) => {
    if (data.detail && !data.fields?.length)
        return sanitizeResult(row);
    const keys = data.fields?.length ? data.fields : summary ? Object.keys(row) : compact;
    if (keys.length > 50 || keys.some((key) => !/^[A-Za-z][\w]{0,100}$/.test(key)))
        throw new HttpsError('invalid-argument', 'Selección de campos inválida.');
    return sanitizeResult(Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]])));
};
export const readEntity = async (collection: 'clients' | 'models' | 'jobs' | 'batches' | 'automationJobs', id: string, caller: DelegatedCaller) => {
    let row: Record<string, any>;
    if (collection === 'clients') {
        assertClientAccess(caller, id);
        const snapshot = await getAppFirestore().collection('clients').doc(validId(id)).get();
        if (!snapshot.exists)
            throw new HttpsError('not-found', 'Cliente no disponible.');
        row = { ...snapshot.data(), id: snapshot.id };
    }
    else
        row = await assertResourceAccess(caller, collection, id);
    if (collection === 'models') {
        row.poses = await Promise.all((row.poses || []).map(async (pose: any) => ({ ...pose, active: isPoseActive(pose), previewUrl: (await admin.storage().bucket().file(pose.previewStoragePath || pose.storagePath).getSignedUrl({ action: 'read', version: 'v4', expires: Date.now() + 900000 }))[0], expiresInSeconds: 900 })));
    }
    return sanitizeResult({ ...row, ...(['jobs', 'batches'].includes(collection) ? { costBasis: 'stored_rate_card_estimates', providerConfirmedUsd: null } : {}) });
};
interface Dataset {
    collection: string;
    global?: boolean;
    parent?: 'jobs' | 'batches' | 'clients';
    owner?: boolean;
    summary?: boolean;
}
const datasets: Record<string, Dataset> = {
    clients: { collection: 'clients' }, models: { collection: 'models' }, jobs: { collection: 'jobs', owner: true }, batches: { collection: 'batches', owner: true }, automation: { collection: 'automationJobs', owner: true },
    outputs: { collection: 'outputs', parent: 'jobs', summary: true }, logs: { collection: 'logs', parent: 'jobs', summary: true }, drafts: { collection: 'productDrafts', parent: 'batches', summary: true }, templates: { collection: 'spreadsheetTemplates', parent: 'clients', summary: true },
    'analytics.summary': { collection: 'analytics_summary', global: true, summary: true }, 'analytics.daily': { collection: 'analytics_daily', global: true, summary: true },
    'analytics.clients': { collection: 'analytics_clients', summary: true }, 'analytics.providers': { collection: 'analytics_providers', global: true, summary: true },
    'analytics.clientProviders': { collection: 'analytics_client_providers', summary: true }, 'analytics.clientModels': { collection: 'analytics_client_models', summary: true },
    'analytics.gemini': { collection: 'analytics_gemini_usage', summary: true }, 'analytics.modelGenerations': { collection: 'model_generation_logs', summary: true }, 'analytics.alerts': { collection: 'system_alert_settings', global: true, summary: true },
    'finance.events': { collection: 'finance_events', summary: true }, 'finance.jobs': { collection: 'finance_snapshots_jobs', summary: true }, 'finance.batches': { collection: 'finance_snapshots_batches', summary: true },
    'finance.clients': { collection: 'finance_snapshots_clients', summary: true }, 'finance.models': { collection: 'finance_snapshots_models', summary: true }, 'finance.providers': { collection: 'finance_snapshots_providers', global: true, summary: true },
    'finance.pricing': { collection: 'finance_client_pricing', summary: true }, 'finance.fixedCosts': { collection: 'finance_fixed_costs', global: true, summary: true }, 'finance.fxRates': { collection: 'finance_fx_rates', global: true, summary: true },
    users: { collection: 'users', global: true, summary: true }, operations: { collection: 'adminOperations', global: true, summary: true },
};
export const queryDataset = async (name: string, data: ManglarQueryRequest & {
    period?: string;
}, caller: DelegatedCaller) => {
    const dataset = datasets[name];
    if (!dataset)
        throw new HttpsError('invalid-argument', 'Consulta no disponible.');
    if (name.startsWith('finance.') || ['users', 'operations'].includes(name))
        requireUnrestrictedAdmin(caller);
    if (name.startsWith('analytics.') && !['admin', 'revisor'].includes(caller.role))
        throw new HttpsError('permission-denied', 'Analytics requiere admin o revisor.');
    if (dataset.global && caller.allowedClientIds !== null)
        throw new HttpsError('permission-denied', 'Los agregados globales requieren acceso a todos los clientes. Usa una consulta por cliente.');
    if (data.limit !== undefined && (!Number.isInteger(data.limit) || data.limit < 1 || data.limit > 100))
        throw new HttpsError('invalid-argument', 'limit debe estar entre 1 y 100.');
    if (data.from && !Number.isFinite(Date.parse(data.from)) || data.to && !Number.isFinite(Date.parse(data.to)))
        throw new HttpsError('invalid-argument', 'Fechas ISO inválidas.');
    if (name === 'clients' && caller.allowedClientIds !== null && !data.clientId) {
        const allowed = [...caller.allowedClientIds].sort().filter(id => !data.cursor || id > data.cursor);
        const pageIds = allowed.slice(0, data.limit || 20);
        const docs = pageIds.length ? await getAppFirestore().getAll(...pageIds.map(id => getAppFirestore().collection('clients').doc(id))) : [];
        return { records: docs.filter(doc => doc.exists && (!data.status || doc.data()?.status === data.status) && (!data.search || String(doc.data()?.name || '').toLowerCase().includes(data.search.toLowerCase()))).map(doc => project({ ...doc.data(), id: doc.id }, data)),
            nextCursor: allowed.length > pageIds.length ? pageIds[pageIds.length - 1] : null, scanned: docs.length, order: 'assigned_client_id' };
    }
    const db = getAppFirestore();
    let collectionPath = dataset.collection;
    let query: Query = db.collection(collectionPath);
    const timeOrdered = ['clients', 'models', 'jobs', 'batches', 'automation', 'outputs', 'logs', 'users', 'analytics.gemini', 'analytics.modelGenerations'].includes(name);
    const sort = data.sort || (timeOrdered ? 'newest' : 'documentId');
    if ((data.from || data.to) && name.startsWith('analytics.') && !timeOrdered && name !== 'analytics.daily') throw new HttpsError('failed-precondition', 'Este agregado es histórico y no tiene fecha de producción. Usa daily o los registros de Gemini/modelos para períodos personalizados.');
    if (dataset.parent) {
        const parentId = dataset.parent === 'jobs' ? data.jobId : dataset.parent === 'batches' ? data.batchId : data.clientId;
        if (!parentId)
            throw new HttpsError('invalid-argument', 'Indica el recurso padre.');
        if (dataset.parent === 'clients')
            assertClientAccess(caller, parentId);
        else
            await assertResourceAccess(caller, dataset.parent, parentId);
        collectionPath = `${dataset.parent}/${validId(parentId)}/${dataset.collection}`;
        query = db.collection(collectionPath);
    }
    else if (!dataset.global) {
        if (data.clientId) {
            assertClientAccess(caller, data.clientId);
            query = name === 'clients' ? query.where(FieldPath.documentId(), '==', data.clientId) : query.where('clientId', '==', data.clientId);
        }
        else if (caller.allowedClientIds !== null) {
            // A concrete client keeps queries bounded and avoids returning global summaries accidentally.
            throw new HttpsError('invalid-argument', 'Indica clientId para esta conexión restringida.');
        }
        if (dataset.owner && caller.role === 'operador' && !data.clientId && !data.batchId)
            query = query.where('createdByUid', '==', caller.uid);
        if (data.batchId) {
            await assertResourceAccess(caller, 'batches', data.batchId);
            if (name === 'jobs' && !data.clientId)
                query = query.where('batchId', '==', data.batchId);
        }
    }
    const pageSize = data.limit ?? 20;
    const scanLimit = Math.min(500, Math.max(100, pageSize * 5));
    query = sort === 'documentId' ? query.orderBy(FieldPath.documentId()) : query.orderBy('createdAt', sort === 'newest' ? 'desc' : 'asc');
    if (data.cursor) {
        const cursor = await db.collection(collectionPath).doc(validId(data.cursor)).get();
        if (!cursor.exists)
            throw new HttpsError('invalid-argument', 'Cursor no disponible.');
        if (!dataset.global && !dataset.parent) {
            assertClientAccess(caller, name === 'clients' ? cursor.id : cursor.data()!.clientId);
            if (dataset.owner && caller.role === 'operador' && cursor.data()!.createdByUid !== caller.uid)
                throw new HttpsError('permission-denied', 'Cursor de otra producción.');
        }
        query = query.startAfter(cursor);
    }
    const snapshots = await query.limit(scanLimit + 1).get();
    const rows: unknown[] = [];
    let last: string | null = null;
    let scanned = 0;
    for (const doc of snapshots.docs.slice(0, scanLimit)) {
        last = doc.id;
        scanned++;
        const row = { ...doc.data(), id: doc.id } as Record<string, any>;
        if (dataset.owner && caller.role === 'operador' && row.createdByUid !== caller.uid)
            continue;
        if (data.batchId && name === 'jobs' && row.batchId !== data.batchId)
            continue;
        if (data.batchId && name === 'batches' && row.id !== data.batchId)
            continue;
        if (data.status && row.status !== data.status || data.provider && row.provider !== data.provider || data.modelId && row.modelId !== data.modelId || data.period && row.period !== data.period)
            continue;
        const dateMillis = row.createdAt?.toMillis?.() ?? Date.parse(row.createdAt || row.date || '');
        const fromMillis = data.from ? Date.parse(data.from) : -Infinity;
        const toMillis = data.to ? Date.parse(data.to) + (/^\d{4}-\d{2}-\d{2}$/.test(data.to) ? 86_400_000 - 1 : 0) : Infinity;
        if ((data.from || data.to) && (!Number.isFinite(dateMillis) || dateMillis < fromMillis || dateMillis > toMillis))
            continue;
        if (data.search && ![row.name, row.displayName, row.email, row.garmentName, doc.id].some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(data.search!.toLocaleLowerCase())))
            continue;
        rows.push(project(row, data, dataset.summary));
        if (rows.length >= pageSize)
            break;
    }
    const hasMore = scanned < snapshots.size;
    return { records: rows, nextCursor: hasMore ? last : null, scanned, order: sort, ...(hasMore ? { partial: true } : {}),
        ...(name.startsWith('finance.') || name.startsWith('analytics.') ? { costBasis: 'stored_estimates_and_recorded_events; provider invoices unavailable' } : {}) };
};
export const spreadsheetCategories = async (data: ManglarQueryRequest, caller: DelegatedCaller) => {
    if (!data.clientId || !data.templateId) throw new HttpsError('invalid-argument', 'Indica cliente y plantilla.');
    if (data.limit !== undefined && (!Number.isInteger(data.limit) || data.limit < 1 || data.limit > 100)) throw new HttpsError('invalid-argument', 'limit debe estar entre 1 y 100.');
    assertClientAccess(caller, data.clientId);
    let query:Query = getAppFirestore().collection('clients').doc(validId(data.clientId)).collection('spreadsheetTemplates').doc(validId(data.templateId)).collection('categories').orderBy(FieldPath.documentId());
    if(data.cursor) query=query.startAfter(validId(data.cursor));
    const pageSize=data.limit||20;
    const snapshot=await query.limit(pageSize+1).get();
    const page=snapshot.docs.slice(0,pageSize);
    return { categories:page.map(doc=>sanitizeResult({...doc.data(),id:doc.id})),nextCursor:snapshot.size>pageSize?page[page.length-1].id:null };
};
export const dashboardSummary = async (data: ManglarQueryRequest, caller: DelegatedCaller) => {
    const batches = await queryDataset('batches', { ...data, limit: Math.min(data.limit || 20, 100) }, caller);
    const jobs = await queryDataset('jobs', { ...data, limit: Math.min(data.limit || 20, 100) }, caller);
    return { batches, jobs, summaryScope: 'paged_activity; not global totals', analyticsAvailable: caller.role !== 'operador' };
};
export const dashboardTotals = async (data: ManglarQueryRequest, caller: DelegatedCaller) => {
    if (data.from || data.to || data.provider || data.search || data.batchId)
        throw new HttpsError('invalid-argument', 'El resumen usa contadores actuales por cliente; usa activity para filtros de fecha/proveedor/lote.');
    if (caller.allowedClientIds !== null && !data.clientId)
        throw new HttpsError('invalid-argument', 'Indica clientId para esta conexión restringida.');
    if (data.clientId)
        assertClientAccess(caller, data.clientId);
    const db = getAppFirestore();
    const result: Record<string, unknown> = {};
    for (const collection of ['jobs', 'batches'] as const) {
        let query: Query = db.collection(collection);
        if (data.clientId)
            query = query.where('clientId', '==', data.clientId);
        if (caller.role === 'operador')
            query = query.where('createdByUid', '==', caller.uid);
        const statuses = collection === 'jobs' ? ['pending', 'processing', 'completed', 'failed'] : ['pending', 'processing', 'completed', 'partial_failed', 'failed'];
        const counts = await Promise.all(statuses.map(async (status) => [status, (await query.where('status', '==', status).count().get()).data().count]));
        result[collection] = Object.fromEntries(counts);
    }
    return { clientId: data.clientId || null, scope: caller.role === 'operador' ? 'own_production' : 'authorized_clients', ...result };
};
