import JSZip from 'jszip';
import type { AutomationJob, Batch, Job } from '../../../shared/src/types';
import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { getAppFirestore } from '../firebase/appFirestore';
import { buildJobImageFilename, readAssetBytes } from '../http/downloadAssets.helpers';
import { remainingAutomationBudget } from '../../../shared/src/automationPolicy';

export const automationReport = (job: AutomationJob, globalMaxBudgetUsd = Infinity) => ({
  photography: job.photoPlan ? { planId: job.photoPlan.id, channels: job.photoPlan.channels, uniqueImages: job.photoPlan.tasks.length, issues: job.photoPlan.issues } : null,
  spendingPaused: job.spendingPaused === true, clientId: job.clientId, clientName: job.clientNameSnapshot || job.clientId, items: job.items || [], policy: job.effectivePolicy || null,
  planId: job.planId || null, estimatedCostUsd: job.estimatedCostUsd ?? null,
  budget: job.budget ? { ...job.budget, effectiveLimitUsd: Math.min(job.budget.limitUsd, globalMaxBudgetUsd), remainingUsd: remainingAutomationBudget({ ...job.budget, limitUsd: Math.min(job.budget.limitUsd, globalMaxBudgetUsd) }), costBasis: 'estimated_not_provider_confirmed' } : null,
  catalogUrl: job.batchId ? `/catalogo?clientId=${encodeURIComponent(job.clientId)}&batchId=${encodeURIComponent(job.batchId)}` : null,
  batchIds: job.batchIds || (job.batchId ? [job.batchId] : []),
  catalogUrls: (job.batchIds || (job.batchId ? [job.batchId] : [])).map(id => `/catalogo?clientId=${encodeURIComponent(job.clientId)}&batchId=${encodeURIComponent(id)}`),
  downloadPath: job.batchId ? `/api/automation/jobs/${job.id}/download` : null,
  issues: [...(job.error ? [job.error] : []), ...(job.items || []).flatMap((item) => item.issue ? [{ itemId: item.itemId, ...item.issue }] : [])],
});
export const automationResultsZip = async (job: AutomationJob): Promise<Buffer> => {
  if (!job.batchId || !job.generationJobIds.length) throw new HttpsError('failed-precondition', 'No hay resultados para descargar.');
  const db = getAppFirestore();
  const batchIds = job.batchIds || [job.batchId];
  const batches = await db.getAll(...batchIds.map(id => db.collection('batches').doc(id)));
  const batchesById = new Map(batches.map(snapshot => [snapshot.id, snapshot.data() as Batch]));
  if (batches.some(snapshot => !snapshot.exists || snapshot.data()?.clientId !== job.clientId || snapshot.data()?.automationJobId !== job.id)) throw new HttpsError('permission-denied', 'Lote no disponible.');
  const snapshots = await db.getAll(...job.generationJobIds.map((id) => db.collection('jobs').doc(id)));
  const scenes = snapshots.map((s) => ({ ...s.data(), id: s.id } as Job)).filter((s) => s.clientId === job.clientId && batchesById.has(s.batchId) && s.automationJobId === job.id && s.status === 'completed' && s.currentOutput?.autoReview?.verdict === 'approved');
  if (!scenes.length) throw new HttpsError('failed-precondition', 'Todavía no hay imágenes aprobadas por Gemini.');
  const client = (await db.doc(`clients/${job.clientId}`).get()).data() as import('../../../shared/src/types').Client | undefined;
  const pendingDestinations = snapshots.flatMap(s => { const j = s.data() as Job; return (j.photoTask?.destinations || []).filter(d => d.required && (!client?.marketplaces?.[d.channel]?.enabled || !j.currentOutput?.photoValidation?.destinations.some(v => v.channel === d.channel && v.position === d.position && v.passed))).map(d => ({ ...d, itemId: j.garmentId, reason: !client?.marketplaces?.[d.channel]?.enabled ? 'channel_disabled' : 'required_photo_pending' })); });
  const zip = new JSZip(); const manifest: unknown[] = []; let size = 0;
  for (const [index, scene] of scenes.entries()) {
    const output = scene.currentOutput!;
    const [metadata] = await admin.storage().bucket().file(output.resultImagePath).getMetadata();
    size += Number(metadata.size || 0);
    if (size > 64 * 1024 * 1024) throw new HttpsError('resource-exhausted', 'El ZIP supera 64 MB; usa los enlaces individuales de los resultados.');
    const name = buildJobImageFilename(batchesById.get(scene.batchId)!, scene, index);
    zip.file(name, await readAssetBytes(output.resultImagePath));
    manifest.push({ fileName: name, clientId: job.clientId, batchId: scene.batchId, modelId: scene.modelId, itemId: scene.garmentId, scene: scene.productScene || scene.poseImageId, jobId: scene.id, outputId: output.id, reviewStatus: 'approved', destinations: (scene.photoTask?.destinations || []).map(d => ({ ...d, deliverable: client?.marketplaces?.[d.channel]?.enabled === true && output.photoValidation?.fidelity === true && output.photoValidation.destinations.some(v => v.channel === d.channel && v.position === d.position && v.passed) })) });
  }
  zip.file('manifest.json', JSON.stringify({ automationJobId: job.id, batchId: job.batchId, batchIds, pendingDestinations, galleriesComplete: pendingDestinations.length === 0, images: manifest }, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
