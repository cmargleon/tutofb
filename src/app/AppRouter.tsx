import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { Layout } from '../components/Layout';
import { Login } from '../pages/Login';
import { Dashboard } from '../pages/Dashboard';
import { Users } from '../pages/Users';
import { Clients } from '../pages/Clients';
import { Models } from '../pages/Models';
import { Wizard } from '../pages/Wizard';
import { Archive } from '../pages/Archive';
import { Analytics } from '../pages/Analytics';
import { Evaluacion } from '../pages/Evaluacion';
import { Cola } from '../pages/Cola';
import { Docs } from '../pages/Docs';
import { LoadingBlock } from '../components/ui';

const ProtectedRoute: React.FC<{ children: React.ReactNode, roles?: string[] }> = ({ children, roles }) => {
  const { user, appUser, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><LoadingBlock /></div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!appUser || !appUser.active) {
    return <Navigate to="/login" replace />;
  }

  // If roles are specified, check if the user has the required role
  if (roles && roles.length > 0) {
    if (!roles.includes(appUser.role)) {
      return <Navigate to="/" replace />;
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
          <Route path="users" element={<ProtectedRoute roles={['admin']}><Users /></ProtectedRoute>} />
          <Route path="clients" element={<ProtectedRoute roles={['admin']}><Clients /></ProtectedRoute>} />
          <Route path="models" element={<ProtectedRoute roles={['admin']}><Models /></ProtectedRoute>} />
          <Route path="generate" element={<ProtectedRoute roles={['admin', 'operador']}><Wizard /></ProtectedRoute>} />
          <Route path="cola" element={<ProtectedRoute roles={['admin', 'operador', 'revisor']}><Cola /></ProtectedRoute>} />
          <Route path="evaluacion" element={<ProtectedRoute roles={['admin', 'operador', 'revisor']}><Evaluacion /></ProtectedRoute>} />
          <Route path="archivo" element={<ProtectedRoute roles={['admin', 'operador', 'revisor']}><Archive /></ProtectedRoute>} />
          <Route path="analytics" element={<ProtectedRoute roles={['admin', 'revisor']}><Analytics /></ProtectedRoute>} />
          <Route path="docs" element={<ProtectedRoute><Docs /></ProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
