import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  CreateFinanceManualEventRequest,
  CreateFinanceManualEventResponse,
  FinanceCurrency,
  FinanceEventCategory,
  FinanceEventType,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { buildMoneySnapshot, getFinanceSettingsCached } from '../finance/currency';
import { recordFinanceEventOnce } from '../finance/events';

const isType = (value: unknown): value is FinanceEventType =>
  value === 'cost' || value === 'revenue' || value === 'adjustment';
const isCurrency = (value: unknown): value is FinanceCurrency => value === 'MXN' || value === 'USD';
const isManualCategory = (value: unknown): value is FinanceEventCategory =>
  value === 'fixed_cost_allocation'
  || value === 'invoiced_revenue'
  || value === 'manual_adjustment'
  || value === 'human_operation'
  || value === 'estimated_revenue';

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const createFinanceManualEvent = onCall<CreateFinanceManualEventRequest, Promise<CreateFinanceManualEventResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin']);
    const type = isType(request.data?.type) ? request.data.type : null;
    const category = isManualCategory(request.data?.category) ? request.data.category : null;
    const currency = isCurrency(request.data?.currency) ? request.data.currency : null;
    const amount = Number(request.data?.amount);
    const description = optionalString(request.data?.description);

    if (!type || !category || !currency || !description || !Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError('invalid-argument', 'Indica tipo, categoría, moneda, descripción y monto positivo.');
    }

    const clientId = optionalString(request.data?.clientId);
    let clientNameSnapshot: string | null = null;
    if (clientId) {
      const clientSnapshot = await getAppFirestore().collection('clients').doc(clientId).get();
      if (!clientSnapshot.exists) {
        throw new HttpsError('not-found', 'No se encontró el cliente seleccionado.');
      }
      clientNameSnapshot = typeof clientSnapshot.data()?.name === 'string' ? clientSnapshot.data()!.name : null;
    }

    const settings = await getFinanceSettingsCached();
    const period = typeof request.data?.period === 'string' && /^\d{4}-\d{2}$/.test(request.data.period)
      ? request.data.period
      : undefined;
    const eventId = getAppFirestore().collection('finance_events').doc().id;
    const money = buildMoneySnapshot({ amount, currency, settings });
    const created = await recordFinanceEventOnce({
      eventId: `manual_${eventId}`,
      period,
      type,
      category,
      description,
      money,
      clientId,
      clientNameSnapshot,
      batchId: optionalString(request.data?.batchId),
      jobId: optionalString(request.data?.jobId),
      modelId: optionalString(request.data?.modelId),
      modelNameSnapshot: null,
      provider: optionalString(request.data?.provider),
      flow: optionalString(request.data?.flow) || 'manual_finance_entry',
      quantity: 1,
      sourceCollection: 'finance_manual_events',
      sourceId: eventId,
      costSnapshot: { enteredByUid: request.auth!.uid },
      sourceCreatedAt: new Date(),
    });

    return { success: true, eventId: `manual_${eventId}`, created };
  },
);
