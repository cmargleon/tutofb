import * as admin from 'firebase-admin';
import { DEFAULT_AUTOMATION_BUDGET } from '../../../shared/src/automationPolicy';
import { PROVIDER_VALUES } from '../../../shared/src/domain';
import type { AutomationJob } from '../../../shared/src/types';
import { HttpsError } from 'firebase-functions/v2/https';
import { getAppFirestore } from '../firebase/appFirestore';
import { canReadAutomation } from './domain';
import { assertMachineClient, assertMachineScope, type MachineCaller } from './machineAuth';
import { automationPolling } from './polling';
import { automationReport } from './results';
import { refreshAutomation } from './worker';

export const getAutomationCapabilities = async (machine: MachineCaller | null, allowedClientIds?: string[] | null) => {
  if (machine) assertMachineScope(machine, 'jobs:read');
  const selectedIds = machine?.principal.allowedClientIds ?? allowedClientIds;
  const clients = selectedIds ? (selectedIds.length ? await getAppFirestore().getAll(...selectedIds.map((id) => getAppFirestore().collection('clients').doc(id))) : []) : (await getAppFirestore().collection('clients').where('status', '==', 'active').limit(100).get()).docs;
  const system = (await getAppFirestore().collection('system_config').doc('main').get()).data();
  return { version: 2, providers: PROVIDER_VALUES.filter((p) => !system?.disabledProviders?.includes(p)), automationBudget: system?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET, maxInputImages: 40, maxReferencesPerItem: 4, endpoints: ['GET /capabilities', 'POST /plans', 'GET /plans/:id', 'POST /plans/:id/execute', 'POST /jobs', 'GET /jobs/:id', 'GET /jobs/:id/download', 'POST /jobs/:id/resume', 'POST /uploads'],
        clients: clients.filter((c) => c.exists && c.data()?.status !== 'archived' && c.data()?.automation?.enabled !== false).map((c) => ({ clientId: c.id, name: c.data()!.name, automation: { enabled: c.data()!.automation?.enabled !== false, driveFolderIds: c.data()!.automation?.driveFolderIds || [], defaultPreset: c.data()!.automation?.defaultPreset || null, defaultModelId: c.data()!.automation?.defaultModelId || null, defaultMaleModelId: c.data()!.automation?.defaultMaleModelId || null, defaultFemaleModelId: c.data()!.automation?.defaultFemaleModelId || null, presets: Object.keys(c.data()!.automation?.presets || {}), defaultBudgetUsd: c.data()!.automation?.defaultBudgetUsd || null }, jobTypes: machine?.principal.allowedJobTypes || ['garment', 'product'] })),
        explicitItemMappingRequired: true, paidPlanning: false, estimatedCostAuthorizationRequired: true };
};

export const readAutomationJobStatus = async (id: string, caller: { uid: string; role: string } | MachineCaller) => {
  if (!/^[\w-]{1,200}$/.test(id)) throw new HttpsError('invalid-argument', 'Trabajo inválido.');
  const stored = (await getAppFirestore().collection('automationJobs').doc(id).get()).data() as AutomationJob | undefined;
  if (!stored || !canReadAutomation(stored, caller.uid, caller.role)) throw new HttpsError('not-found', 'Trabajo no encontrado.');
  if (caller.role === 'automation') {
    const machine = caller as MachineCaller;
    assertMachineScope(machine, 'jobs:read');
    assertMachineClient(machine.principal, stored.clientId, stored.jobType);
  }
    const job = (await refreshAutomation(id))!;
    const outputs = await Promise.all(job.outputImages.map(async (output) => {
      const [url] = await admin.storage().bucket().file(output.storagePath).getSignedUrl({ action: 'read', version: 'v4', expires: Date.now() + 15 * 60_000 });
      return { url, type: output.type, metadata: { clientId: job.clientId, generationJobId: output.jobId, itemId: output.itemId, scene: output.type, outputId: output.outputId || null, reviewStatus: 'approved' }, expiresInSeconds: 900 };
    }));
    const currentBudget = (await getAppFirestore().collection('system_config').doc('main').get()).data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET;
    return { jobId: job.id, status: job.status, progress: job.progress, outputs, error: job.error, batchId: job.batchId, retryCount: job.retryCount, ...automationPolling(job), ...automationReport(job, currentBudget.maxBudgetUsd) };
};
