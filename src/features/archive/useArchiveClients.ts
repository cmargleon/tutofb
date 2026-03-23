import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { Client } from '../../../shared/src/types';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';

export const useArchiveClients = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
