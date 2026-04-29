import { onCall } from 'firebase-functions/v2/https';
import {
  FinanceBatchSnapshot,
  FinanceClientPricing,
  FinanceClientSnapshot,
  FinanceDashboardData,
  FinanceEvent,
  FinanceModelSnapshot,
  FinanceProviderSnapshot,
  FinanceSummarySnapshot,
  GetFinanceDashboardRequest,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { getFinanceSettingsCached } from '../finance/currency';
import { getFinancePeriod } from '../finance/events';

const byProfitAsc = <T extends { grossProfitMxn: number }>(left: T, right: T) => left.grossProfitMxn - right.grossProfitMxn;
const byUpdatedDesc = <T extends { createdAt?: any; updatedAt?: any }>(left: T, right: T) => {
  const leftMillis = left.createdAt?.toMillis?.() || left.updatedAt?.toMillis?.() || 0;
  const rightMillis = right.createdAt?.toMillis?.() || right.updatedAt?.toMillis?.() || 0;
  return rightMillis - leftMillis;
};

const readPeriodCollection = async <T>(collectionName: string, period: string): Promise<T[]> => {
  const snapshot = await getAppFirestore().collection(collectionName).where('period', '==', period).limit(250).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as T));
};

export const getFinanceDashboard = onCall<GetFinanceDashboardRequest, Promise<FinanceDashboardData>>(async (request) => {
  await assertCallableRoles(request, ['admin']);
  const period = typeof request.data?.period === 'string' && /^\d{4}-\d{2}$/.test(request.data.period)
    ? request.data.period
    : getFinancePeriod(new Date());
  const clientId = typeof request.data?.clientId === 'string' && request.data.clientId.trim()
    ? request.data.clientId.trim()
    : null;

  const db = getAppFirestore();
  const settings = await getFinanceSettingsCached();
  const [summarySnapshot, clients, batches, providers, models, eventsSnapshot, pricingSnapshot] = await Promise.all([
    db.collection('finance_snapshots_global').doc(period).get(),
    readPeriodCollection<FinanceClientSnapshot>('finance_snapshots_clients', period),
    db.collection('finance_snapshots_batches').limit(250).get(),
    readPeriodCollection<FinanceProviderSnapshot>('finance_snapshots_providers', period),
    readPeriodCollection<FinanceModelSnapshot>('finance_snapshots_models', period),
    db.collection('finance_events').where('period', '==', period).limit(250).get(),
    db.collection('finance_client_pricing').get(),
  ]);

  const allBatches = batches.docs.map((doc) => ({ id: doc.id, ...doc.data() } as FinanceBatchSnapshot));
  const allEvents = eventsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as FinanceEvent));

  return {
    settings,
    summary: summarySnapshot.exists ? ({ id: summarySnapshot.id, ...summarySnapshot.data() } as FinanceSummarySnapshot) : null,
    clients: clients
      .filter((entry) => !clientId || entry.clientId === clientId)
      .sort(byProfitAsc)
      .slice(0, 50),
    batches: allBatches
      .filter((entry) => !entry.period || entry.period === period)
      .filter((entry) => !clientId || entry.clientId === clientId)
      .sort(byProfitAsc)
      .slice(0, 50),
    providers: providers.sort(byProfitAsc).slice(0, 25),
    models: models
      .filter((entry) => !clientId || entry.clientId === clientId)
      .sort(byProfitAsc)
      .slice(0, 50),
    recentEvents: allEvents
      .filter((entry) => !clientId || entry.clientId === clientId)
      .sort(byUpdatedDesc)
      .slice(0, 50),
    pricing: pricingSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as FinanceClientPricing))
      .filter((entry) => !clientId || entry.clientId === clientId)
      .sort((left, right) => left.clientNameSnapshot.localeCompare(right.clientNameSnapshot, 'es')),
  };
});
