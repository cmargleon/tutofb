import JSZip from 'jszip';
import type { AutomationJob, Batch, Job } from '../../../shared/src/types';
import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { getAppFirestore } from '../firebase/appFirestore';
import { buildJobImageFilename, readAssetBytes } from '../http/downloadAssets.helpers';
import { remainingAutomationBudget } from '../../../shared/src/automationPolicy';

export const automationReport = (job: AutomationJob, globalMaxBudgetUsd = Infinity) => ({
  spendingPaused: job.spendingPaused === true, clientId: job.clientId, clientName: job.clientNameSnapshot || job.clientId, items: job.items || [], policy: job.effectivePolicy || null,
  planId: job.planId || null, estimatedCostUsd: job.estimatedCostUsd ?? null,
  budget: job.budget ? { ...job.budget, effectiveLimitUsd: Math.min(job.budget.limitUsd, globalMaxBudgetUsd), remainingUsd: remainingAutomationBudget({ ...job.budget, limitUsd: Math.min(job.budget.limitUsd, globalMaxBudgetUsd) }), costBasis: 'estimated_not_provider_confirmed' } : null,
  catalogUrl: job.batchId ? `/catalogo?clientId=${encodeURIComponent(job.clientId)}&batchId=${encodeURIComponent(job.batchId)}` : null,
  downloadPath: job.batchId ? `/api/automation/jobs/${job.id}/download` : null,
  issues: [...(job.error ? [job.error] : []), ...(job.items || []).flatMap((item) => item.issue ? [{ itemId: item.itemId, ...item.issue }] : [])],
});
export const automationResultsZip = async (job: AutomationJob): Promise<Buffer> => {
  if (!job.batchId || !job.generationJobIds.length) throw new HttpsError('failed-precondition', 'No hay resultados para descargar.');
  const db = getAppFirestore();
  const batch = (await db.collection('batches').doc(job.batchId).get()).data() as Batch;
  if (!batch || batch.clientId !== job.clientId || batch.automationJobId !== job.id) throw new HttpsError('permission-denied', 'Lote no disponible.');
  const snapshots = await db.getAll(...job.generationJobIds.map((id) => db.collection('jobs').doc(id)));
  const scenes = snapshots.map((s) => ({ ...s.data(), id: s.id } as Job)).filter((s) => s.clientId === job.clientId && s.batchId === job.batchId && s.automationJobId === job.id && s.status === 'completed' && s.currentOutput?.autoReview?.verdict === 'approved');
  if (!scenes.length) throw new HttpsError('failed-precondition', 'Todavía no hay imágenes aprobadas por Gemini.');
  const zip = new JSZip(); const manifest: unknown[] = []; let size = 0;
  for (const [index, scene] of scenes.entries()) {
    const output = scene.currentOutput!;
    const [metadata] = await admin.storage().bucket().file(output.resultImagePath).getMetadata();
    size += Number(metadata.size || 0);
    if (size > 64 * 1024 * 1024) throw new HttpsError('resource-exhausted', 'El ZIP supera 64 MB; usa los enlaces individuales de los resultados.');
    const name = buildJobImageFilename(batch, scene, index);
    zip.file(name, await readAssetBytes(output.resultImagePath));
    manifest.push({ fileName: name, clientId: job.clientId, itemId: scene.garmentId, scene: scene.productScene || scene.poseImageId, jobId: scene.id, outputId: output.id, reviewStatus: 'approved' });
  }
  zip.file('manifest.json', JSON.stringify({ automationJobId: job.id, batchId: job.batchId, images: manifest }, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
