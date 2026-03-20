import { getAppFirestore } from '../firebase/appFirestore';

const db = getAppFirestore();

export const recursiveDeleteDocuments = async (
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<void> => {
  for (const docSnapshot of docs) {
    await db.recursiveDelete(docSnapshot.ref);
  }
};
