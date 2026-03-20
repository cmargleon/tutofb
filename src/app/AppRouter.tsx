import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { Layout } from '../components/Layout';
import { Login } from '../pages/Login';
import { Dashboard } from '../pages/Dashboard';
import { Clients } from '../pages/Clients';
import { Models } from '../pages/Models';
import { Wizard } from '../pages/Wizard';
import { Archive } from '../pages/Archive';
import { Analytics } from '../pages/Analytics';
import { Evaluacion } from '../pages/Evaluacion';
import { LoadingBlock } from '../components/ui';

const ProtectedRoute: React.FC<{ children: React.ReactNode, roles?: string[] }> = ({ children, roles }) => {
  const { user, appUser, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><LoadingBlock /></div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // If roles are specified, check if the user has the required role
  if (roles && roles.length > 0) {
    // If appUser is not loaded yet but user is logged in, we might still be fetching it.
    // However, if it's null after loading, they don't have a role.
    if (!appUser || !roles.includes(appUser.role)) {
      // If the user is the default admin, allow them anyway
      const isDefaultAdmin = user.email === 'claudiomatiasrg@gmail.com';
      if (!isDefaultAdmin || !roles.includes('admin')) {
        return <Navigate to="/" replace />;
      }
    }
  }

  return <>{children}</>;
};

export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="clients" element={<ProtectedRoute roles={['admin', 'operador']}><Clients /></ProtectedRoute>} />
          <Route path="models" element={<ProtectedRoute roles={['admin', 'operador']}><Models /></ProtectedRoute>} />
          <Route path="generate" element={<ProtectedRoute roles={['admin', 'operador']}><Wizard /></ProtectedRoute>} />
          <Route path="evaluacion" element={<ProtectedRoute roles={['admin', 'operador', 'revisor']}><Evaluacion /></ProtectedRoute>} />
          <Route path="archivo" element={<ProtectedRoute roles={['admin', 'operador', 'revisor']}><Archive /></ProtectedRoute>} />
          <Route path="analytics" element={<ProtectedRoute roles={['admin', 'operador', 'revisor']}><Analytics /></ProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
