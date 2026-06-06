import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ExportBatchSpreadsheetRequest,
  ExportBatchSpreadsheetResponse,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { ensureStorageDownloadUrl } from '../firebase/storageDownloadUrl';
import { prepareBatchSpreadsheetExport } from '../spreadsheets/batchSpreadsheetExport';

const bucket = admin.storage().bucket();

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

export const exportBatchSpreadsheet = onCall<
  ExportBatchSpreadsheetRequest,
  Promise<ExportBatchSpreadsheetResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

  const batchId = requireNonEmptyString(request.data?.batchId, 'El lote');
  const { clientId, workbookBuffer, fileName } = await prepareBatchSpreadsheetExport(batchId);
  const storagePath = `client_spreadsheet_exports/${clientId}/${batchId}/${randomUUID()}-${fileName}`;
  await bucket.file(storagePath).save(workbookBuffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const downloadUrl = await ensureStorageDownloadUrl(storagePath);

  return {
    success: true,
    batchId,
    storagePath,
    downloadUrl,
    fileName,
  };
});
