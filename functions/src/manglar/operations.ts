import { HttpsError } from 'firebase-functions/v2/https';
import type { Operation } from './registry';
import { callableOperations } from './registry';
import type { DelegatedCaller } from './context';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertClientAccess, assertResourceAccess, authorizeManglarInput, isClientScopeSubset, loadManglarAccess, loadManglarUser, requireUnrestrictedAdmin, validId } from './access';
import { dashboardTotals, dashboardSummary, queryDataset, readEntity, sanitizeResult, spreadsheetCategories } from './reads';
import { saveClientService, saveModelService, setCatalogArchivedService, replaceModelPoseService, flagJobService } from './catalogService';
import { classifyModelPoses } from './models';
import { listConnections, revokeConnection, setUserAccess, getUserAccess } from './connections';
import { manualImageDefaults, wizardDefaults, saveWizardDraft, getWizardDraft, classifyWizardDraft, correctWizardDraft, previewGarmentGeneration, previewProductGeneration, assertWizardDraftGeneration } from './wizard';
import { uploadPolicy, previewFile, thumbnailFile, importDriveReference, discardTemporaryFile } from './files';
import { createBatchArchive, resolveJobAsset, saveTemporaryArchive, signedAsset } from '../http/downloadAssets.service';
import { buildModelBundleDownload } from '../http/downloadModelBundle';
import { automationResultsZip } from '../automation/results';
import { readAutomationJobStatus } from '../automation/queries';
import type { AutomationJob } from '../../../shared/src/types';
import { callableRequest } from './request';
const custom: Operation[] = [];
const op = (domain: string, action: string, contract: string | null, roles: Operation['roles'], risk: Operation['risk'], source: string, run: Operation['run']) => custom.push({ domain, action, contract, roles, risk, source, run });
const all: Operation['roles'] = ['admin', 'operador', 'revisor'];
const producers: Operation['roles'] = ['admin', 'operador'];
for (const [domain, collection] of [['clients', 'clients'], ['models', 'models'], ['catalog', 'jobs'], ['automation', 'automationJobs']] as const) {
    op(domain, 'list', 'ManglarQueryRequest', domain === 'automation' ? producers : all, 'read', domain === 'catalog' ? 'src/features/catalog/useCatalogJobs.ts' : `src/features/${domain}/firebase.ts`, (data, caller) => queryDataset(domain === 'catalog' ? 'jobs' : domain === 'automation' ? 'automation' : domain, data, caller));
    op(domain, 'get', 'ManglarGetRequest', domain === 'automation' ? producers : all, 'read', `functions/src/manglar/reads.ts`, (data, caller) => readEntity(collection, data.id, caller));
}
op('clients', 'save', 'ManglarClientSaveRequest', ['admin'], 'write', 'functions/src/manglar/catalogService.ts', (data, caller) => saveClientService(data, caller.uid));
for (const domain of ['clients', 'models'] as const)
    for (const action of ['archive', 'restore'])
        op(domain, action, 'ManglarEntityStateRequest', ['admin'], 'write', 'functions/src/manglar/catalogService.ts', (data, caller) => setCatalogArchivedService(domain, data, caller.uid, action === 'archive'));
op('models', 'save', 'ManglarModelSaveRequest', ['admin'], 'paid', 'functions/src/manglar/catalogService.ts', (data, caller) => saveModelService(data, caller.uid));
op('models', 'replacePose', 'ManglarPoseReplaceRequest', ['admin'], 'write', 'functions/src/manglar/catalogService.ts', (data, caller) => replaceModelPoseService(data, caller.uid));
op('models', 'classify', 'ManglarPoseClassifyRequest', ['admin'], 'paid', 'functions/src/utils/classifyPose.ts', classifyModelPoses);
op('models', 'export', 'ManglarGetRequest', ['admin'], 'read', 'functions/src/http/downloadModelBundle.ts', (data) => buildModelBundleDownload(data.id));
op('catalog', 'batches', 'ManglarQueryRequest', all, 'read', 'src/features/queue/firebase.ts', (data, caller) => queryDataset('batches', data, caller));
op('catalog', 'batch', 'ManglarGetRequest', all, 'read', 'functions/src/manglar/reads.ts', (data, caller) => readEntity('batches', data.id, caller));
for (const dataset of ['outputs', 'logs', 'drafts'])
    op('catalog', dataset, 'ManglarQueryRequest', all, 'read', 'src/features/evaluation/firebase.ts', (data, caller) => queryDataset(dataset, data, caller));
op('catalog', 'flag', 'ManglarJobFlagRequest', all, 'write', 'functions/src/manglar/catalogService.ts', (data, caller) => flagJobService(data, caller.uid));
op('spreadsheets', 'templates', 'ManglarQueryRequest', all, 'read', 'src/features/clients/firebase.ts', (data, caller) => queryDataset('templates', data, caller));
op('spreadsheets', 'categories', 'ManglarQueryRequest', all, 'read', 'src/features/clients/firebase.ts', spreadsheetCategories);
op('dashboard', 'summary', 'ManglarQueryRequest', all, 'read', 'src/features/dashboard/firebase.ts', dashboardTotals);
op('dashboard', 'activity', 'ManglarQueryRequest', all, 'read', 'src/features/dashboard/firebase.ts', dashboardSummary);
op('analytics', 'query', 'ManglarAnalyticsRequest', ['admin', 'revisor'], 'read', 'src/features/analytics/useAnalyticsDashboard.ts', (data, caller) => queryDataset(`analytics.${data.dataset}`, data, caller));
op('finance', 'query', 'ManglarFinanceQueryRequest', ['admin'], 'read', 'src/features/finance/firebase.ts', (data, caller) => queryDataset(`finance.${data.dataset}`, data, caller));
op('users', 'list', 'ManglarQueryRequest', ['admin'], 'read', 'src/features/users/firebase.ts', (data, caller) => queryDataset('users', data, caller));
op('users', 'get', 'ManglarGetRequest', ['admin'], 'read', 'src/features/users/firebase.ts', async (data) => {
    const snapshot = await getAppFirestore().collection('users').doc(validId(data.id)).get();
    if (!snapshot.exists)
        throw new HttpsError('not-found', 'Usuario no encontrado.');
    return sanitizeResult({ ...snapshot.data(), uid: snapshot.id });
});
op('system', 'operations', 'ManglarQueryRequest', ['admin'], 'read', 'functions/src/admin/backfillModelPoses.ts', (data, caller) => queryDataset('operations', data, caller));
op('connections', 'list', 'ManglarConnectionListRequest', all, 'read', 'functions/src/automation/mcpOAuth.ts', listConnections);
op('connections', 'revoke', 'ManglarConnectionRevokeRequest', all, 'critical', 'functions/src/automation/mcpOAuth.ts', (data, caller) => revokeConnection(data.connectionId, caller));
op('connections', 'setAccess', 'ManglarAccessRequest', ['admin'], 'critical', 'functions/src/manglar/connections.ts', setUserAccess);
op('connections', 'access', 'ManglarGetRequest', all, 'read', 'functions/src/manglar/connections.ts', (data, caller) => getUserAccess(data.id, caller));
op('wizard', 'defaults', null, producers, 'read', 'src/features/generate/wizard/state.ts', wizardDefaults);
op('wizard', 'saveDraft', 'ManglarDraftRequest', producers, 'write', 'functions/src/manglar/wizard.ts', saveWizardDraft);
op('wizard', 'draft', 'ManglarDraftGetRequest', producers, 'read', 'functions/src/manglar/wizard.ts', async (data, caller) => sanitizeResult(await getWizardDraft(data.id, caller)));
op('wizard', 'classify', 'ManglarDraftClassifyRequest', producers, 'paid', 'functions/src/callables/classifyGarmentViewsWithGemini.ts', classifyWizardDraft);
op('wizard', 'correct', 'ManglarDraftCorrectRequest', producers, 'write', 'functions/src/manglar/wizard.ts', correctWizardDraft);
op('wizard', 'previewGarment', 'CreateGenerationBatchRequest', producers, 'read', 'functions/src/callables/createGenerationBatch.helpers.ts', previewGarmentGeneration);
op('wizard', 'previewProduct', 'CreateProductGenerationBatchRequest', producers, 'read', 'functions/src/callables/createProductGenerationBatch.helpers.ts', previewProductGeneration);
op('wizard', 'createGarment', 'ManglarGarmentDraftGenerationRequest', producers, 'paid', 'functions/src/callables/createGenerationBatch.ts', async (data, caller) => {
    await assertWizardDraftGeneration(data.draftId, data.request, 'garment', caller);
    return (await import('../callables/createGenerationBatch')).createGenerationBatch.run(callableRequest(manualImageDefaults(data.request), caller));
});
op('wizard', 'createProduct', 'ManglarProductDraftGenerationRequest', producers, 'paid', 'functions/src/callables/createProductGenerationBatch.ts', async (data, caller) => {
    await assertWizardDraftGeneration(data.draftId, data.request, 'product', caller);
    return (await import('../callables/createProductGenerationBatch')).createProductGenerationBatch.run(callableRequest(manualImageDefaults(data.request), caller));
});
op('files', 'upload', 'ManglarUploadRequest', producers, 'write', 'functions/src/manglar/files.ts', uploadPolicy);
op('files', 'thumbnail', 'ManglarFileRequest', all, 'read', 'functions/src/manglar/files.ts', (data, caller) => thumbnailFile(data.storagePath, caller));
op('files', 'preview', 'ManglarFileRequest', all, 'read', 'functions/src/manglar/files.ts', (data, caller) => previewFile(data.storagePath, caller));
op('files', 'importDrive', 'ManglarDriveImportRequest', producers, 'write', 'functions/src/automation/drive.ts', importDriveReference);
op('files', 'discard', 'ManglarFileRequest', producers, 'destructive', 'functions/src/manglar/files.ts', (data, caller) => discardTemporaryFile(data.storagePath, caller));
op('files', 'image', 'ManglarImageRequest', all, 'read', 'functions/src/http/downloadAssets.service.ts', async (data, caller) => {
    await assertResourceAccess(caller, 'jobs', data.jobId);
    const { output } = await resolveJobAsset(data);
    return { jobId: data.jobId, outputId: output.id, ...await signedAsset(output.resultImagePath) };
});
op('files', 'zip', 'ManglarZipRequest', all, 'read', 'functions/src/http/downloadAssets.service.ts', async (data, caller) => {
    await assertResourceAccess(caller, 'batches', data.batchId);
    const archive = await createBatchArchive(data, { maxFiles: 100, maxBytes: 64 * 1024 * 1024, strictOutputs: true });
    return saveTemporaryArchive(archive.bytes, archive.filename);
});
op('automation', 'status', 'ManglarGetRequest', producers, 'read', 'functions/src/automation/queries.ts', async (data, caller) => {
    await assertResourceAccess(caller, 'automationJobs', data.id);
    return readAutomationJobStatus(data.id, caller);
});
op('automation', 'download', 'ManglarGetRequest', producers, 'read', 'functions/src/automation/results.ts', async (data, caller) => {
    const job = await assertResourceAccess(caller, 'automationJobs', data.id) as unknown as AutomationJob;
    return saveTemporaryArchive(await automationResultsZip(job), `automation-${data.id}.zip`);
});
op('automation', 'prepare', 'CreateAutomationJobRequest', producers, 'write', 'functions/src/automation/plans.ts', async (data, caller) => {
    const plans = await import('../automation/plans');
    return plans.publicAutomationPlan(await plans.prepareAutomationPlan(data, caller.uid, caller.role));
});
op('automation', 'plan', 'ManglarGetRequest', producers, 'read', 'functions/src/automation/plans.ts', async (data, caller) => {
    const plans = await import('../automation/plans');
    const plan = await plans.readAutomationPlan(data.id, caller.uid, caller.role);
    assertClientAccess(caller, plan.clientId);
    return { ...plans.publicAutomationPlan(plan), prompts: { prompt: plan.preset.prompt, scenes: plan.preset.scenes } };
});
op('automation', 'execute', 'ManglarExecutePlanRequest', producers, 'paid', 'functions/src/automation/plans.ts', async (data, caller) => {
    const plans = await import('../automation/plans');
    const plan = await plans.readAutomationPlan(data.planId, caller.uid, caller.role);
    assertClientAccess(caller, plan.clientId);
    if (data.confirmedBudgetUsd !== plan.policy.budgetUsd)
        throw new HttpsError('failed-precondition', 'Confirma el presupuesto exacto del plan.');
    return plans.executeAutomationPlan(data.planId, caller.uid, caller.role);
});
export const MANGLAR_OPERATIONS: Operation[] = [...callableOperations, ...custom];
export const findOperation = (domain: string, action: string): Operation => {
    const operation = MANGLAR_OPERATIONS.find(op => op.domain === domain && op.action === action);
    if (!operation)
        throw new HttpsError('not-found', 'Operación MCP no disponible.');
    return operation;
};
export const authorizeOperation = async (operation: Operation, data: any, caller: DelegatedCaller): Promise<void> => {
    const user = await loadManglarUser(caller.uid);
    const access = await loadManglarAccess(caller.uid, user.role);
    if (!access.enabled || user.role !== caller.role || access.version !== caller.accessVersion || !operation.roles.includes(user.role) || !isClientScopeSubset(access.clientIds, caller.allowedClientIds))
        throw new HttpsError('permission-denied', 'Tu usuario no tiene permiso para esta operación.');
    if (!caller.scopes.includes(operation.risk === 'read' ? 'jobs:read' : 'jobs:create'))
        throw new HttpsError('permission-denied', 'Scope OAuth insuficiente.');
    if (['system', 'users', 'finance'].includes(operation.domain)) {
        if (operation.domain === 'system' && operation.action === 'health' && caller.role === 'revisor' && caller.allowedClientIds === null) { /* global reviewer */ }
        else
            requireUnrestrictedAdmin(caller);
    }
    if (operation.domain === 'clients' && data.id)
        assertClientAccess(caller, data.id);
    if (operation.domain === 'clients' && operation.action === 'save' && !data.id)
        requireUnrestrictedAdmin(caller);
    if (operation.domain === 'models' && data.id) {
        const exists = (await getAppFirestore().collection('models').doc(validId(data.id)).get()).exists;
        if (exists)
            await assertResourceAccess(caller, 'models', data.id);
        else if (operation.action !== 'save')
            throw new HttpsError('not-found', 'Modelo no disponible.');
    }
    if (operation.domain === 'automation' && data.jobId) {
        await assertResourceAccess(caller, 'automationJobs', data.jobId);
        const { jobId: _, ...rest } = data;
        await authorizeManglarInput(caller, rest);
        return;
    }
    await authorizeManglarInput(caller, data);
};
