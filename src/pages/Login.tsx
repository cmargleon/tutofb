import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { auth, db } from '../firebase';
import { syncUserClaims } from '../features/auth/firebase';
import { User as AppUser } from '../../shared/src/types';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const user = credential.user;
      const userSnapshot = await getDoc(doc(db, 'users', user.uid));

      if (!userSnapshot.exists()) {
        await signOut(auth);
        throw new Error('Tu usuario no está habilitado en el sistema. Pide a un administrador que te dé acceso.');
      }

      const appUser = userSnapshot.data() as AppUser;
      if (!appUser.active) {
        await signOut(auth);
        throw new Error('Tu usuario está desactivado. Pide a un administrador que revise tu acceso.');
      }

      await syncUserClaims(user.uid);
      await user.getIdToken(true);
      navigate('/');
    } catch (submitError: any) {
      console.error(submitError);
      setError(submitError.message || 'No se pudo iniciar sesión.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60 overflow-hidden">
        <div className="bg-slate-950 px-8 py-10 text-white">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]">
            <ShieldCheck className="w-4 h-4" />
            Acceso interno
          </div>
          <h1 className="mt-5 text-3xl font-semibold">Tuto Catalog</h1>
          <p className="mt-2 text-sm text-slate-300">
            Inicia sesión con tu usuario interno para trabajar en generación, evaluación y archivo.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 py-8 space-y-5">
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Correo</span>
            <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4">
              <Mail className="w-4 h-4 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none"
                placeholder="tu@empresa.com"
                autoComplete="email"
                required
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Contraseña</span>
            <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4">
              <LockKeyhole className="w-4 h-4 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none"
                placeholder="Ingresa tu contraseña"
                autoComplete="current-password"
                required
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? 'Validando acceso...' : 'Entrar al sistema'}
          </button>

          <p className="text-center text-xs text-slate-500">
            El acceso se controla por Firebase Auth y roles internos sincronizados con custom claims.
          </p>
        </form>
      </div>
    </div>
  );
};
