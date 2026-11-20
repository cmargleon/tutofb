import type { Model, ModelBaseApproval, ModelBaseOperation, Pose } from './types';
import type { MarketplaceId } from './marketplaces';

const poseApprovals = (pose: Pose, approvals: ModelBaseApproval[]) => approvals.filter(a =>
  a.poseId === pose.id && a.storagePath === pose.storagePath && !a.requiresReverification);

/** A failed channel review must not revoke approval for a different channel. */
export function modelBasePoseActiveAfterReview(pose: Pose, approvals: ModelBaseApproval[]): boolean {
  return poseApprovals(pose, approvals).length > 0 || (!pose.marketplaceBaseSpec && pose.active !== false);
}

export function groupModelCatalogPoses(model: Model, operations: ModelBaseOperation[] = []) {
  const channels: MarketplaceId[] = ['shein', 'amazon', 'tiktok-shop', 'mercado-libre'];
  const marketplaces = channels.map(channel => ({ channel, poses: model.poses.filter(p =>
    poseApprovals(p, model.marketplaceBaseApprovals || []).some(a => a.spec.channel === channel)) }));
  const approved = new Set(marketplaces.flatMap(group => group.poses.map(p => p.id)));
  const rejected: Array<{ pose: Pose; reason: string }> = [];
  const other: Pose[] = [];
  for (const pose of model.poses) {
    if (approved.has(pose.id)) continue;
    const attempt = operations.flatMap(op => op.attempts).find(a => a.poseId === pose.id);
    const reason = attempt?.error || (attempt?.verification?.approved === false ? attempt.verification.issues.join(' ') || 'Verificación rechazada.' : '');
    if (reason && pose.id !== model.approvedIdentity?.poseId) rejected.push({ pose, reason });
    else other.push(pose);
  }
  return { marketplaces, other, rejected };
}

export function modelPoseZoneAndShot(pose: Pose): string {
  const area = pose.marketplaceBaseSpec?.bodyArea || pose.photoObservation?.framing || pose.aiClassification?.bodyFocus || pose.aiClassification?.framing;
  const zone = (area === 'upper_body' || area === 'medium_body') ? 'Superior' : area === 'lower_body' || area === 'footwear' || area === 'feet' || area === 'feet_closeup' ? 'Inferior' : area === 'full_body' ? 'Completa' : 'Zona sin verificar';
  const shot = pose.marketplaceBaseSpec?.shot || pose.photoObservation?.pose || pose.aiClassification?.orientationDetail;
  const view = shot === 'front' ? 'Frente' : shot === 'commercial_back' || shot === 'back' ? 'Espalda' : shot?.includes('quarter') ? '3/4' : 'Toma sin verificar';
  return `${zone} · ${view}`;
}
