import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { AnalyticsSummary, Batch, Client, Job, Model } from '../../../shared/src/types';
import { db } from '../../firebase';
import { isActiveCatalogEntity } from '../../../shared/src/domain';

export interface DashboardSnapshot {
  clients: Client[];
  models: Model[];
  recentBatches: Batch[];
  recentJobs: Job[];
}

export const subscribeToDashboardData = (
  onData: (snapshot: DashboardSnapshot) => void,
  onError: (error: Error) => void,
) => {
  let latestClients: Client[] = [];
  let latestModels: Model[] = [];
  let latestBatches: Batch[] = [];
  let latestJobs: Job[] = [];

  const emit = () => {
    onData({
      clients: latestClients,
      models: latestModels,
      recentBatches: latestBatches,
      recentJobs: latestJobs,
    });
  };

  const unsubscribers = [
    onSnapshot(
      query(collection(db, 'clients'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        latestClients = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() } as Client))
          .filter(isActiveCatalogEntity);
        emit();
      },
      onError,
    ),
    onSnapshot(
      query(collection(db, 'models'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        latestModels = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() } as Model))
          .filter(isActiveCatalogEntity);
        emit();
      },
      onError,
    ),
    onSnapshot(
      query(collection(db, 'batches'), orderBy('createdAt', 'desc'), limit(20)),
      (snapshot) => {
        latestBatches = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Batch));
        emit();
      },
      onError,
    ),
    onSnapshot(
      query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(50)),
      (snapshot) => {
        latestJobs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Job));
        emit();
      },
      onError,
    ),
  ];

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
};

export const subscribeToAnalyticsSummary = (
  onData: (summary: AnalyticsSummary | null) => void,
  onError: (error: Error) => void,
) =>
  onSnapshot(
    doc(db, 'analytics_summary', 'global'),
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }

      onData(snapshot.data() as AnalyticsSummary);
    },
    onError,
  );
