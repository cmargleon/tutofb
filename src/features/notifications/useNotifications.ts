import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { AnalyticsSummary, Batch, BatchNotificationRetryState, BatchStatus } from '../../../shared/src/types';
import { useToast } from '../feedback/FeedbackProvider';
import { BatchNotificationItem, buildBatchNotificationDescription, buildBatchNotificationItem, isFinalBatchStatus, resolveBatchNotificationOutcome } from './batchNotifications';

export interface UseNotificationsReturn {
  queueCount: number;
  notifications: BatchNotificationItem[];
  unreadCount: number;
  isNotifOpen: boolean;
  notifRef: React.RefObject<HTMLDivElement>;
  onBellClick: () => void;
  onCloseNotif: () => void;
}

export const useNotifications = (): UseNotificationsReturn => {
  const toast = useToast();
  const [queueCount, setQueueCount] = useState(0);
  const [notifications, setNotifications] = useState<BatchNotificationItem[]>([]);
  const [notifSeenAt, setNotifSeenAt] = useState(() => {
    const stored = localStorage.getItem('notifSeenAt');
    return stored ? parseInt(stored, 10) : 0;
  });
  const sessionStartRef = useRef(Date.now());
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const isFirstBatchSnapshotRef = useRef(true);
  const batchStateRef = useRef<Record<string, {
    status: BatchStatus;
    retryState: BatchNotificationRetryState | null;
  }>>({});

  useEffect(() => {
    const unsubQueue = onSnapshot(doc(db, 'analytics_summary', 'global'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as AnalyticsSummary;
        setQueueCount((data.pendingJobs ?? 0) + (data.processingJobs ?? 0));
      } else {
        setQueueCount(0);
      }
    });

    const unsubBatches = onSnapshot(
      query(collection(db, 'batches'), orderBy('updatedAt', 'desc'), limit(60)),
      (snap) => {
        const nextState: typeof batchStateRef.current = {};
        const nextNotifications = snap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Batch & { id: string }))
          .filter((batch) => isFinalBatchStatus(batch.status))
          .map((batch) => buildBatchNotificationItem(batch))
          .slice(0, 8);

        snap.docs.forEach((docSnapshot) => {
          const batch = { id: docSnapshot.id, ...docSnapshot.data() } as Batch & { id: string };
          nextState[batch.id] = {
            status: batch.status,
            retryState: batch.notification?.retryState ?? null,
          };
        });

        if (isFirstBatchSnapshotRef.current) {
          isFirstBatchSnapshotRef.current = false;
          batchStateRef.current = nextState;
          setNotifications(nextNotifications);
          return;
        }
        snap.docs.forEach((docSnapshot) => {
          const batch = { id: docSnapshot.id, ...docSnapshot.data() } as Batch & { id: string };
          const previous = batchStateRef.current[batch.id];
          if (!previous) return;

          const nowIsFinal = isFinalBatchStatus(batch.status);
          const reachedFinal =
            nowIsFinal
            && (
              !isFinalBatchStatus(previous.status)
              || (previous.retryState === 'queued' && batch.notification?.retryState !== 'queued')
            );

          if (!reachedFinal) return;

          const outcome = resolveBatchNotificationOutcome(batch);
          toast({
            title: outcome === 'completed' ? 'Lote completado' : 'Lote fallido',
            description: `${batch.clientNameSnapshot} · ${batch.modelNameSnapshot} · ${buildBatchNotificationDescription(batch)}`,
            tone: outcome === 'completed' ? 'success' : 'error',
            durationMs: 6000,
          });
        });
        batchStateRef.current = nextState;
        setNotifications(nextNotifications);
      },
    );

    return () => { unsubQueue(); unsubBatches(); };
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

  const unreadCount = notifications.filter((notification) =>
    notification.updatedAtMs > Math.max(sessionStartRef.current, notifSeenAt)).length;

  const onBellClick = () => {
    setIsNotifOpen((open) => !open);
    const now = Date.now();
    setNotifSeenAt(now);
    localStorage.setItem('notifSeenAt', String(now));
  };

  const onCloseNotif = () => setIsNotifOpen(false);

  return { queueCount, notifications, unreadCount, isNotifOpen, notifRef, onBellClick, onCloseNotif };
};
