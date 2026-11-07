import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldPath, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Client, ListClientsRequest, ListClientsResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { loadHumanClientIds } from '../auth/clientAccess';
import { getAppFirestore } from '../firebase/appFirestore';

/** Native cursor scan preserves legacy substring semantics without an index/data migration.
 * Each Firestore read is capped at 20; only a maximum of 20 matching clients leaves the server.
 * Numeric URL pages are replayed with cursors, so direct links work without browser-only state.
 */
export async function listClientsPage(input: ListClientsRequest, ids: string[] | null, db: Firestore = getAppFirestore()): Promise<ListClientsResponse> {
  if (!input || typeof input !== 'object' || input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 500)
    || input.status !== undefined && !['all', 'active', 'archived'].includes(input.status)
    || input.showArchived !== undefined && typeof input.showArchived !== 'boolean'
    || input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 100000))
    throw new HttpsError('invalid-argument', 'Filtros inválidos.');
  const requested = input.page ?? 1;
  const search = (input.search ?? '').trim().toLowerCase();
  let cursor: QueryDocumentSnapshot | undefined;
  let count = 0;
  let currentPage: Client[] = [];
  let previousPage: Client[] = [];
  let page = 1;
  // Empty assigned scope is a valid empty list, never a global fallback.
  if (ids?.length === 0) return { clients: [], page: 1, hasMore: false };
  // Assigned clients are queried by ID, in deterministic chunks; no foreign client is fetched.
  const chunks = ids === null ? [null] : Array.from({ length: Math.ceil(ids.length / 20) }, (_, i) => [...ids].sort().slice(i * 20, i * 20 + 20));
  for (const chunk of chunks) {
    cursor = undefined;
    while (true) {
      let q = db.collection('clients').orderBy(FieldPath.documentId()).limit(20);
      if (chunk) q = q.where(FieldPath.documentId(), 'in', chunk);
      if (cursor) q = q.startAfter(cursor);
      const snapshot = await q.get();
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const status = data.status ?? 'active';
        if ((!input.showArchived && status === 'archived') || (input.status && input.status !== 'all' && status !== input.status)
          || typeof data.name !== 'string' || !data.name.toLowerCase().includes(search)) continue;
        if (count === requested * 20) return { clients: currentPage, page: requested, hasMore: true };
        if (count % 20 === 0) { previousPage = currentPage; currentPage = []; page = Math.floor(count / 20) + 1; }
        const client = { ...data, id: doc.id } as Client;
        for (const key of ['createdAt', 'updatedAt', 'archivedAt', 'lastBatchCreatedAt'] as const) {
          const value = client[key];
          if (value && typeof value.toDate === 'function') client[key] = value.toDate().toISOString();
        }
        currentPage.push(client);
        count++;
      }
      if (snapshot.size < 20) break;
      cursor = snapshot.docs.at(-1);
    }
  }
  return { clients: currentPage.length ? currentPage : previousPage, page, hasMore: false };
}
export const listClients = onCall<ListClientsRequest>({ timeoutSeconds: 120 }, async request => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  return listClientsPage(request.data, await loadHumanClientIds(request.auth!.uid));
});
