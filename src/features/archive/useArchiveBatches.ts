import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../../firebase';
import { collection, query, where, orderBy, limit, startAfter, onSnapshot, QueryDocumentSnapshot } from 'firebase/firestore';
import { Batch } from '../../../shared/src/types';

export const useArchiveBatches = (clientId: string | null, pageSize: number = 20) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [pageCursors, setPageCursors] = useState<QueryDocumentSnapshot[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

  // We need to keep a reference to the unsubscribe function for the current page
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const loadPage = useCallback((pageIndex: number, startAfterDoc?: QueryDocumentSnapshot) => {
    if (!clientId) {
      setBatches([]);
      setHasNextPage(false);
      return;
    }

    setLoading(true);
    setError(null);

    let q = query(
      collection(db, 'batches'),
      where('clientId', '==', clientId),
      orderBy('createdAt', 'desc'),
      limit(pageSize + 1) // Fetch one extra to check if there's a next page
    );

    if (startAfterDoc) {
      q = query(q, startAfter(startAfterDoc));
    }

    const unsub = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs;
      const hasMore = docs.length > pageSize;
      const visibleDocs = hasMore ? docs.slice(0, pageSize) : docs;

      const fetchedBatches = visibleDocs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Batch));

      setBatches(fetchedBatches);
      setHasNextPage(hasMore);
      setCurrentPage(pageIndex);
      setLoading(false);

      // Store the cursor for the next page if there is one
      if (hasMore) {
        setPageCursors(prev => {
          const newCursors = [...prev];
          newCursors[pageIndex] = visibleDocs[visibleDocs.length - 1];
          return newCursors;
        });
      }
    }, (err) => {
      console.error('Error fetching archive batches:', err);
      setError('Error al cargar lotes');
      setLoading(false);
    });

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }
    unsubscribeRef.current = unsub;
  }, [clientId, pageSize]);

  useEffect(() => {
    // Reset when client changes
    setPageCursors([]);
    setCurrentPage(0);
    setHasNextPage(false);
    
    if (clientId) {
      loadPage(0);
    } else {
      setBatches([]);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [clientId, loadPage]);

  const nextPage = () => {
    if (hasNextPage && pageCursors[currentPage]) {
      loadPage(currentPage + 1, pageCursors[currentPage]);
    }
  };

  const prevPage = () => {
    if (currentPage > 0) {
      const prevCursor = currentPage - 1 > 0 ? pageCursors[currentPage - 2] : undefined;
      loadPage(currentPage - 1, prevCursor);
    }
  };

  return { 
    batches, 
    loading, 
    error, 
    currentPage, 
    hasNextPage, 
    nextPage, 
    prevPage 
  };
};
