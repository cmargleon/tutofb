import * as admin from 'firebase-admin';

const db = admin.firestore();

export const recursiveDeleteDocuments = async (
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<void> => {
  for (const docSnapshot of docs) {
    await db.recursiveDelete(docSnapshot.ref);
  }
};
