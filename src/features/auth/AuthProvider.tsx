import { humanClientIds } from '../../../shared/src/clientAccess';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { clearStorageAssetCache } from '../storage/assets';
import { clearClientDrafts } from '../clients/draftStorage';
import { User as AppUser } from '../../../shared/src/types';

interface AuthContextType {
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, appUser: null, loading: true });

export const useAuth = () => useContext(AuthContext);

export const useRole = () => {
  const { appUser: current } = useAuth();
  const appUser = current?.active === true && current.status !== 'archived' ? current : null;
  
  return {
    isAdmin: appUser?.role === 'admin',
    isOperador: appUser?.role === 'operador',
    isRevisor: appUser?.role === 'revisor',
    isActive: appUser?.active === true,
    canManageUsers: appUser?.role === 'admin',
    canManageClients: appUser?.role === 'admin',
    canManageModels: appUser?.role === 'admin',
    canCreateBatches: appUser?.role === 'admin' || appUser?.role === 'operador',
    canEvaluate: appUser?.role === 'admin' || appUser?.role === 'operador' || appUser?.role === 'revisor',
    canRegenerate: appUser?.role === 'admin' || appUser?.role === 'operador',
    canAccessAnalytics: Boolean(appUser && humanClientIds(appUser) === null && (appUser.role === 'admin' || appUser.role === 'revisor')),
    canAccessFinance: appUser?.role === 'admin',
  };
};

export type RoleCapabilities = ReturnType<typeof useRole>;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeDoc: (() => void) | undefined;
    let identity: string | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      clearStorageAssetCache();
      unsubscribeDoc?.();
      unsubscribeDoc = undefined;
      if (identity && identity !== firebaseUser?.uid) clearClientDrafts(auth.app.options.projectId!, identity);
      identity = firebaseUser?.uid ?? null;
      setAppUser(null);
      setLoading(true);
      setUser(firebaseUser);
      if (firebaseUser) {
        unsubscribeDoc = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (userDoc) => {
            if (auth.currentUser?.uid !== firebaseUser.uid) return;
            if (userDoc.exists()) {
              clearStorageAssetCache();
              setAppUser(userDoc.data() as AppUser);
            } else {
              setAppUser(null);
            }
            setLoading(false);
          },
          (error) => {
            console.error("Error fetching user data:", error);
            setAppUser(null);
            setLoading(false);
          }
        );
      } else {
        setAppUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) {
        unsubscribeDoc();
      }
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, appUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
