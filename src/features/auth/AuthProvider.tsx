import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
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
    canManageClients: appUser?.role === 'admin',
    canManageModels: appUser?.role === 'admin',
    canCreateBatches: appUser?.role === 'admin' || appUser?.role === 'operador',
    canEvaluate: appUser?.role === 'admin' || appUser?.role === 'operador' || appUser?.role === 'revisor',
  };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeDoc: () => void;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        unsubscribeDoc = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (userDoc) => {
            if (userDoc.exists()) {
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
