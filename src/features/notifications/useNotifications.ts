import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { AnalyticsSummary, Batch, Job } from '../../../shared/src/types';
import { useToast } from '../feedback/FeedbackProvider';

export interface UseNotificationsReturn {
  queueCount: number;
  notifications: Job[];
  unreadCount: number;
  isNotifOpen: boolean;
  notifRef: React.RefObject<HTMLDivElement>;
  onBellClick: () => void;
  onCloseNotif: () => void;
}

export const useNotifications = (): UseNotificationsReturn => {
  const toast = useToast();
  const [queueCount, setQueueCount] = useState(0);
  const [notifications, setNotifications] = useState<Job[]>([]);
  const [notifSeenAt, setNotifSeenAt] = useState(() => {
    const stored = localStorage.getItem('notifSeenAt');
    return stored ? parseInt(stored, 10) : 0;
  });
  const sessionStartRef = useRef(Date.now());
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const isFirstBatchSnapshotRef = useRef(true);

  useEffect(() => {
    const unsubQueue = onSnapshot(doc(db, 'analytics_summary', 'global'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as AnalyticsSummary;
        setQueueCount((data.pendingJobs ?? 0) + (data.processingJobs ?? 0));
      } else {
        setQueueCount(0);
      }
    });

    const unsubNotif = onSnapshot(
      query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(30)),
      (snap) => {
        const jobs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Job))
          .filter((j) => j.status === 'completed' || j.status === 'failed');
        setNotifications(jobs.slice(0, 8));
      },
    );

    const unsubBatches = onSnapshot(
      query(collection(db, 'batches'), orderBy('updatedAt', 'desc'), limit(20)),
      (snap) => {
        if (isFirstBatchSnapshotRef.current) {
          isFirstBatchSnapshotRef.current = false;
          return;
        }
        snap.docChanges().forEach((change) => {
          if (change.type !== 'modified') return;
          const batch = { id: change.doc.id, ...change.doc.data() } as Batch;
          const client = batch.clientNameSnapshot;
          const model = batch.modelNameSnapshot;
          if (batch.status === 'completed') {
            toast({
              title: 'Lote completado',
              description: `${client} · ${model} · ${batch.completedJobs} imágenes`,
              tone: 'success',
              durationMs: 6000,
            });
          } else if (batch.status === 'partial_failed') {
            toast({
              title: 'Lote parcialmente completado',
              description: `${client} · ${model} · ${batch.failedJobs} jobs fallaron`,
              tone: 'warning',
              durationMs: 6000,
            });
          } else if (batch.status === 'failed') {
            toast({
              title: 'Lote fallido',
              description: `${client} · ${model}`,
              tone: 'error',
              durationMs: 6000,
            });
          }
        });
      },
    );

    return () => { unsubQueue(); unsubNotif(); unsubBatches(); };
  }, [toast]);

  useEffect(() => {
    if (!isNotifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isNotifOpen]);

  const unreadCount = notifications.filter((j) => {
    const ms = j.createdAt && typeof (j.createdAt as any).toMillis === 'function'
      ? (j.createdAt as any).toMillis()
      : 0;
    return ms > Math.max(sessionStartRef.current, notifSeenAt);
  }).length;

  const onBellClick = () => {
    setIsNotifOpen((open) => !open);
    const now = Date.now();
    setNotifSeenAt(now);
    localStorage.setItem('notifSeenAt', String(now));
  };

  const onCloseNotif = () => setIsNotifOpen(false);

  return { queueCount, notifications, unreadCount, isNotifOpen, notifRef, onBellClick, onCloseNotif };
};
