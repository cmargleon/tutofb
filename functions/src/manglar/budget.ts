import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { getAppFirestore } from '../firebase/appFirestore';
import { getManglarContext, withManglarContext } from './context';
import { loadManglarAccess, loadManglarUser } from './access';
import { oauthHash } from '../automation/mcpOAuth.helpers';
// Conservative holds, not a contractual upper bound on a token-priced provider's bill.
export const runManglarPaid = async <T>(holdUsd: number, run: () => Promise<T>, budgetId = getManglarContext()?.budgetId): Promise<T> => {
    if (!budgetId)
        return run(); // Existing UI and automation retain their budget mechanisms.
    const db = getAppFirestore();
    const ref = db.collection('manglarOperations').doc(budgetId);
    const initial = (await ref.get()).data();
    if (!initial)
        throw new HttpsError('failed-precondition', 'No existe autorización de gasto MCP.');
    const user = await loadManglarUser(initial.ownerUid);
    const access = await loadManglarAccess(initial.ownerUid, user.role);
    if (!access.enabled || access.version !== initial.accessVersion || user.role !== initial.role)
        throw new HttpsError('permission-denied', 'Autorización de gasto revocada.');
    const payment = ref.collection('payments').doc(randomUUID());
    await db.runTransaction(async (tx) => {
        const [snapshot, grant] = await tx.getAll(ref, db.collection('automationOAuth').doc(`grant-${oauthHash(initial.connectionId)}`));
        const operation = snapshot.data();
        const connection = grant.data();
        if (!connection?.active || connection.expiresAt.toMillis() <= Date.now())
            throw new HttpsError('permission-denied', 'Conexión revocada o vencida.');
        if (!operation || !['running', 'completed'].includes(operation.state) || !operation.allowEstimatedCosts || !Number.isFinite(holdUsd) || holdUsd <= 0
            || operation.committedUsd + holdUsd > operation.budgetUsd + 1e-8)
            throw new HttpsError('resource-exhausted', 'El presupuesto MCP no autoriza otra llamada pagada. Las demás escenas conservan sus resultados.');
        tx.create(payment, { holdUsd, state: 'reserved', createdAt: FieldValue.serverTimestamp() });
        tx.update(ref, { committedUsd: operation.committedUsd + holdUsd });
    });
    try {
        const result = await run();
        await payment.update({ state: 'estimated', settledAt: FieldValue.serverTimestamp() });
        return result;
    }
    catch (error) {
        // Keep the entire hold after ambiguous errors/timeouts; retrying requires remaining budget.
        await payment.update({ state: 'uncertain', settledAt: FieldValue.serverTimestamp() });
        throw error;
    }
};
export const withManglarJobBudget = async <T>(jobId: string, run: () => Promise<T>): Promise<T> => {
    const job = (await getAppFirestore().collection('jobs').doc(jobId).get()).data();
    return job?.manglarBudgetId ? withManglarContext({ budgetId: job.manglarBudgetId }, run) : run();
};
