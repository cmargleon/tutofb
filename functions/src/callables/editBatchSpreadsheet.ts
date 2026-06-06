import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  EditBatchSpreadsheetRequest,
  EditBatchSpreadsheetResponse,
  User,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { GOOGLE_PRIVATE_KEY } from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import {
  createGoogleSheetFromXlsx,
  shareGoogleSheetWithEditor,
  updateGoogleSheetFromXlsx,
} from '../google/drive';
import { prepareBatchSpreadsheetExport } from '../spreadsheets/batchSpreadsheetExport';

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

const getRequesterEmail = async (uid: string, tokenEmail: unknown): Promise<string | null> => {
  const normalizedTokenEmail = typeof tokenEmail === 'string' ? tokenEmail.trim() : '';
  if (normalizedTokenEmail) {
    return normalizedTokenEmail;
  }

  const userSnapshot = await getAppFirestore().collection('users').doc(uid).get();
  if (!userSnapshot.exists) {
    return null;
  }

  const user = userSnapshot.data() as User;
  return user.email?.trim() || null;
};

const isMissingGoogleConfigError = (error: unknown): boolean =>
  error instanceof Error && /^GOOGLE_[A-Z_]+ no está configurada\.$/.test(error.message);

const isMissingDriveFileError = (error: unknown): boolean =>
  error instanceof Error && /(?:file not found|not found|404)/i.test(error.message);

export const editBatchSpreadsheet = onCall<
  EditBatchSpreadsheetRequest,
  Promise<EditBatchSpreadsheetResponse>
>(
  { secrets: [GOOGLE_PRIVATE_KEY], timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

    const batchId = requireNonEmptyString(request.data?.batchId, 'El lote');
    const refreshMode = request.data?.refreshMode === 'create_new_version'
      ? 'create_new_version'
      : 'replace_existing';
    const requesterEmail = await getRequesterEmail(request.auth!.uid, request.auth!.token.email);
    const prepared = await prepareBatchSpreadsheetExport(batchId);
    const existingSheetId = prepared.batch.googleSheetId?.trim() || null;
    const existingSheetUrl = prepared.batch.googleSheetUrl?.trim() || null;
    const existingWorkbookHash = prepared.batch.googleSheetWorkbookHash?.trim() || null;

    try {
      if (
        existingSheetId
        && existingSheetUrl
        && refreshMode !== 'create_new_version'
        && (!existingWorkbookHash || existingWorkbookHash === prepared.workbookHash)
      ) {
        if (requesterEmail) {
          await shareGoogleSheetWithEditor({ sheetId: existingSheetId, editorEmail: requesterEmail });
        }
        console.info('Opening existing Google Sheet for batch spreadsheet.', { batchId, sheetId: existingSheetId });
        return {
          success: true,
          batchId,
          sheetId: existingSheetId,
          sheetUrl: existingSheetUrl,
          created: false,
          updated: false,
        };
      }

      if (existingSheetId && refreshMode !== 'create_new_version') {
        try {
          const updatedSheet = await updateGoogleSheetFromXlsx({
            sheetId: existingSheetId,
            workbookBuffer: prepared.workbookBuffer,
            sheetName: prepared.sheetName,
          });
          if (requesterEmail) {
            await shareGoogleSheetWithEditor({ sheetId: updatedSheet.sheetId, editorEmail: requesterEmail });
          }
          await prepared.batchRef.update({
            googleSheetId: updatedSheet.sheetId,
            googleSheetUrl: updatedSheet.sheetUrl,
            googleSheetUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            googleSheetWorkbookHash: prepared.workbookHash,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.info('Updated existing Google Sheet for batch spreadsheet.', { batchId, sheetId: updatedSheet.sheetId });
          return {
            success: true,
            batchId,
            sheetId: updatedSheet.sheetId,
            sheetUrl: updatedSheet.sheetUrl,
            created: false,
            updated: true,
          };
        } catch (error) {
          if (!isMissingDriveFileError(error)) {
            throw error;
          }
          console.warn('Stored Google Sheet was not found in Drive; creating a new one.', { batchId, sheetId: existingSheetId });
        }
      }

      const createdSheet = await createGoogleSheetFromXlsx({
        workbookBuffer: prepared.workbookBuffer,
        sheetName: prepared.sheetName,
      });
      if (requesterEmail) {
        await shareGoogleSheetWithEditor({ sheetId: createdSheet.sheetId, editorEmail: requesterEmail });
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      await prepared.batchRef.update({
        googleSheetId: createdSheet.sheetId,
        googleSheetUrl: createdSheet.sheetUrl,
        googleSheetCreatedAt: now,
        googleSheetUpdatedAt: now,
        googleSheetWorkbookHash: prepared.workbookHash,
        updatedAt: now,
      });
      console.info('Created Google Sheet for batch spreadsheet.', { batchId, sheetId: createdSheet.sheetId });

      return {
        success: true,
        batchId,
        sheetId: createdSheet.sheetId,
        sheetUrl: createdSheet.sheetUrl,
        created: true,
        updated: false,
      };
    } catch (error) {
      console.error('Error preparing Google Sheet for batch spreadsheet.', { batchId, error });
      if (error instanceof HttpsError) {
        throw error;
      }
      if (isMissingGoogleConfigError(error)) {
        throw new HttpsError('failed-precondition', error instanceof Error ? error.message : 'Falta configuración de Google Drive.');
      }

      const message = error instanceof Error && error.message
        ? error.message
        : 'Google Drive no pudo preparar el Sheet editable.';
      throw new HttpsError('internal', message);
    }
  },
);
