import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { SetClientSpreadsheetTemplateStatusRequest, SpreadsheetTemplate } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';

const statuses = ['active', 'disabled', 'archived'];

export const setClientSpreadsheetTemplateStatus = onCall<SetClientSpreadsheetTemplateStatusRequest>(async request => {
  await assertCallableRoles(request, ['admin']);
  const { clientId, templateId, status, expectedStatus } = request.data;
  if (!statuses.includes(status) || !statuses.includes(expectedStatus)) throw new HttpsError('invalid-argument', 'Estado de plantilla inválido.');
  const db = getAppFirestore();
  const client = db.collection('clients').doc(validId(clientId));
  const ref = client.collection('spreadsheetTemplates').doc(validId(templateId));
  await db.runTransaction(async tx => {
    const [owner, snapshot] = await tx.getAll(client, ref);
    const template = snapshot.data() as SpreadsheetTemplate | undefined;
    if (!owner.exists || owner.get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente no disponible.');
    if (!template) throw new HttpsError('not-found', 'Plantilla no encontrada.');
    const current = template.status ?? 'active';
    if (current === status) return;
    if (current !== expectedStatus) throw new HttpsError('aborted', 'La plantilla cambió. Actualiza antes de continuar.');
    if (template.exportConfig?.supersededByTemplateId) throw new HttpsError('failed-precondition', 'La plantilla fue sustituida por otra versión.');
    if (current === 'archived' && status !== 'disabled') throw new HttpsError('failed-precondition', 'Restaura primero la plantilla como desactivada.');
    const archived = status === 'archived';
    const now = FieldValue.serverTimestamp();
    tx.update(ref, {
      status, updatedAt: now, archivedAt: archived ? now : null,
      archivedByUid: archived ? request.auth!.uid : null,
      preserveHistoricalUse: archived ? true : FieldValue.delete(),
    });
  });
  return { success: true as const, status };
});
