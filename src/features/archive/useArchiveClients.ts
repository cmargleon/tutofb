import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { Client } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';

export const useArchiveClients = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // We want clients that have batches. If batchCount is not reliably maintained, 
    // we can just fetch all clients and filter, or if batchCount > 0 is supported:
    const clientsQuery = query(
      collection(db, 'clients'),
      where('batchCount', '>', 0),
      orderBy('batchCount', 'desc'), // Firestore requires orderBy on the same field as where '>'
      orderBy('lastBatchCreatedAt', 'desc')
    );

    // If the above query requires a composite index that doesn't exist, 
    // a simpler approach is to fetch all clients and filter locally, or just order by lastBatchCreatedAt.
    // Let's try ordering by lastBatchCreatedAt desc if we assume clients with batches have it set.
    const simpleQuery = query(
      collection(db, 'clients'),
      orderBy('lastBatchCreatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(simpleQuery, (snapshot) => {
      const fetchedClients = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Client)).filter(c => (c.batchCount || 0) > 0 || isArchivedCatalogEntity(c));
      
      setClients(fetchedClients);
      setLoading(false);
    }, (err) => {
      console.error('Error fetching archive clients:', err);
      setError('Error al cargar clientes');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { clients, loading, error };
};
