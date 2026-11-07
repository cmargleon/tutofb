import { documentId, doc, onSnapshot, query, where, type Query, type QuerySnapshot, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import { humanClientIds } from '../../../shared/src/clientAccess';
import type { User } from '../../../shared/src/types';

/** Query constraints enforce scope at the server, before any documents are downloaded. */
export function subscribeHumanQuery(reference: Query, field: 'clientId' | '__name__', next: (snapshot: QuerySnapshot) => void, error: (error: Error) => void): Unsubscribe {
  const uid = auth.currentUser?.uid;
  if (!uid) { error(new Error('Debes iniciar sesión.')); return () => {}; }
  let children: Unsubscribe[] = [];
  let generation = 0;
  const unsubscribe = onSnapshot(doc(db, 'users', uid), snapshot => {
    children.forEach(stop => stop()); children = [];
    const version = ++generation;
    const user = snapshot.data() as User | undefined;
    if (!user || user.active !== true || user.status === 'archived') { error(new Error('La cuenta no está activa.')); return; }
    const ids = humanClientIds(user);
    if (ids === null) { children = [onSnapshot(reference, next, error)]; return; }
    if (!ids.length) { next({ docs: [], size: 0, empty: true } as unknown as QuerySnapshot); return; }
    const chunks: string[][] = [];
    // <=5 keeps combined queries below Firestore's disjunction limit.
    for (let i = 0; i < ids.length; i += 5) chunks.push(ids.slice(i, i + 5));
    const results = new Map<number, QuerySnapshot>();
    children = chunks.map((chunk, index) => onSnapshot(query(reference, where(field === '__name__' ? documentId() : field, 'in', chunk)), result => {
      if (version !== generation) return;
      results.set(index, result);
      if (results.size === chunks.length) {
        const docs = [...results.values()].flatMap(item => item.docs);
        next({ docs, size: docs.length, empty: !docs.length } as unknown as QuerySnapshot);
      }
    }, error));
  }, error);
  return () => { generation++; unsubscribe(); children.forEach(stop => stop()); };
}
