import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ProductDraft,
  ProductDraftRow,
  UpdateBatchProductDraftRequest,
  UpdateBatchProductDraftResponse,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

const normalizeProductDraftRows = (value: unknown): ProductDraftRow[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError('invalid-argument', 'Debes enviar al menos una fila para el product draft.');
  }

  return value.map((row, rowIndex) => {
    if (!row || typeof row !== 'object') {
      throw new HttpsError('invalid-argument', `La fila ${rowIndex + 1} del product draft es inválida.`);
    }

    const record = row as Partial<ProductDraftRow>;
    const id = requireNonEmptyString(record.id, `El id de la fila ${rowIndex + 1}`);
    const values = record.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new HttpsError('invalid-argument', `Los valores de la fila ${rowIndex + 1} son inválidos.`);
    }

    return {
      id,
      values: Object.fromEntries(
        Object.entries(values).map(([key, entryValue]) => [key, typeof entryValue === 'string' ? entryValue : String(entryValue ?? '')]),
      ),
    };
  });
};

export const updateBatchProductDraft = onCall<UpdateBatchProductDraftRequest, Promise<UpdateBatchProductDraftResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

    const batchId = requireNonEmptyString(request.data?.batchId, 'El lote');
    const draftId = requireNonEmptyString(request.data?.draftId, 'El draft');
    const rows = normalizeProductDraftRows(request.data?.rows);

    const db = getAppFirestore();
    const batchRef = db.collection('batches').doc(batchId);
    const draftRef = batchRef.collection('productDrafts').doc(draftId);
    const [batchSnapshot, draftSnapshot] = await Promise.all([batchRef.get(), draftRef.get()]);

    if (!batchSnapshot.exists) {
      throw new HttpsError('not-found', 'Lote no encontrado.');
    }

    if (!draftSnapshot.exists) {
      throw new HttpsError('not-found', 'Product draft no encontrado.');
    }

    const existingDraft = { id: draftSnapshot.id, ...draftSnapshot.data() } as ProductDraft;
    await draftRef.update({
      rows,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: request.auth!.uid,
      generatedImages: existingDraft.generatedImages || [],
    });

    return {
      success: true,
      batchId,
      draftId,
    };
  },
);
