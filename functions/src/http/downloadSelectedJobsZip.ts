import { authorizeHumanInput, loadHumanClientIds } from '../auth/clientAccess';
import * as admin from 'firebase-admin';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import { assertUserRoles } from '../auth/roles';
import { getBearerToken, parseBody, setCorsHeaders } from './downloadAssets.helpers';
import { createBatchArchive } from './downloadAssets.service';
import type { ManglarZipRequest } from '../../../shared/src/types';

export const downloadSelectedJobsZip = onRequest({ timeoutSeconds: 300, cors: true }, async (request, response) => {
  setCorsHeaders(request.headers.origin, response);
  if (request.method === 'OPTIONS') { response.status(204).send(''); return; }
  if (request.method !== 'POST') { response.status(405).json({ message: 'Método no permitido.' }); return; }
  try {
    const token = getBearerToken(request.header('Authorization'));
    if (!token) throw new HttpsError('unauthenticated', 'Debes iniciar sesión para descargar.');
    const decoded = await admin.auth().verifyIdToken(token);
    await assertUserRoles(decoded.uid, decoded.role, ['admin','operador','revisor']);
    const body = parseBody(request.body) as unknown as ManglarZipRequest;
    if (!Array.isArray(body.jobIds) || !body.jobIds.length) throw new HttpsError('invalid-argument', 'Indica al menos un job.');
    await authorizeHumanInput(decoded.uid, body, await loadHumanClientIds(decoded.uid));
    const archive = await createBatchArchive(body);
    response.set('Content-Type','application/zip');
    response.set('Content-Disposition',`attachment; filename="${archive.filename}"`);
    response.set('Cache-Control','private, no-store, max-age=0');
    response.status(200).send(archive.bytes);
  } catch (error) {
    const code = error instanceof HttpsError ? error.code : 'internal';
    const status = ({ unauthenticated:401, 'permission-denied':403, 'not-found':404, 'failed-precondition':400, 'invalid-argument':400, 'resource-exhausted':400 } as Record<string,number>)[code] || 500;
    response.status(status).json({ message: error instanceof HttpsError ? error.message : 'No se pudo preparar la descarga.' });
  }
});
