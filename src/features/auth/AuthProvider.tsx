import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../../firebase';
import { getIdTokenResult, onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { User as AppUser } from '../../../shared/src/types';

interface AuthContextType {
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, appUser: null, loading: true });

export const useAuth = () => useContext(AuthContext);

export const useRole = () => {
  const { appUser } = useAuth();
  
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
    canAccessAnalytics: appUser?.role === 'admin' || appUser?.role === 'revisor',
    canAccessFinance: appUser?.role === 'admin',
  };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeDoc: () => void;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setLoading(true);
      setUser(firebaseUser);
      if (firebaseUser) {
        unsubscribeDoc = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          async (userDoc) => {
            if (userDoc.exists()) {
              const tokenResult = await getIdTokenResult(firebaseUser);
              const appUserData = userDoc.data() as AppUser;
              setAppUser({
                ...appUserData,
                role: (tokenResult.claims.role as AppUser['role']) || appUserData.role,
              });
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
        if (unsubscribeDoc) {
          unsubscribeDoc();
        }
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
