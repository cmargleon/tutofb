import { getApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';

export const APP_FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID || '(default)';

let firestoreInstance: Firestore | null = null;

export const getAppFirestore = (): Firestore => {
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(getApp(), APP_FIRESTORE_DATABASE_ID);
  }

  return firestoreInstance;
};
