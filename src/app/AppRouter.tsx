import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { LoadingBlock } from '../components/ui';
import { PageErrorBoundary } from '../components/PageErrorBoundary';

const Layout = lazy(() => import('../components/Layout').then((module) => ({ default: module.Layout })));
const Login = lazy(() => import('../pages/Login').then((module) => ({ default: module.Login })));
const Dashboard = lazy(() => import('../pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Users = lazy(() => import('../pages/Users').then((module) => ({ default: module.Users })));
const Clients = lazy(() => import('../pages/Clients').then((module) => ({ default: module.Clients })));
const Models = lazy(() => import('../pages/Models').then((module) => ({ default: module.Models })));
const ModelsGenerate = lazy(() => import('../pages/ModelsGenerate').then((module) => ({ default: module.ModelsGenerate })));
const ModelsCatalog = lazy(() => import('../pages/ModelsCatalog').then((module) => ({ default: module.ModelsCatalog })));
const Wizard = lazy(() => import('../pages/Wizard').then((module) => ({ default: module.Wizard })));
const Analytics = lazy(() => import('../pages/Analytics').then((module) => ({ default: module.Analytics })));
const Finanzas = lazy(() => import('../pages/Finanzas').then((module) => ({ default: module.Finanzas })));
const Cola = lazy(() => import('../pages/Cola').then((module) => ({ default: module.Cola })));
const Configuracion = lazy(() => import('../pages/Configuracion').then((module) => ({ default: module.Configuracion })));
const Catalogo = lazy(() => import('../pages/Catalogo').then((module) => ({ default: module.Catalogo })));

const RouteLoadingFallback: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <LoadingBlock />
  </div>
);

const ClientsRedirect: React.FC = () => {
  const location = useLocation();
  const targetPath = location.hash.startsWith('#client-') ? '/clients/lista' : '/clients/crear';

  return <Navigate replace to={`${targetPath}${location.search}${location.hash}`} />;
};

const UsersRedirect: React.FC = () => {
  const location = useLocation();

  return <Navigate replace to={`/users/crear${location.search}${location.hash}`} />;
};

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
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<PageErrorBoundary><Dashboard /></PageErrorBoundary>} />
            <Route path="users" element={<ProtectedRoute roles={['admin']}><UsersRedirect /></ProtectedRoute>} />
            <Route path="users/crear" element={<ProtectedRoute roles={['admin']}><PageErrorBoundary><Users view="create" /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="users/lista" element={<ProtectedRoute roles={['admin']}><PageErrorBoundary><Users view="list" /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="clients" element={<ProtectedRoute roles={['admin']}><ClientsRedirect /></ProtectedRoute>} />
            <Route path="clients/crear" element={<ProtectedRoute roles={['admin']}><PageErrorBoundary><Clients view="create" /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="clients/lista" element={<ProtectedRoute roles={['admin']}><PageErrorBoundary><Clients view="list" /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="models" element={<ProtectedRoute roles={['admin']}><PageErrorBoundary><Models /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="models/generar" element={<ProtectedRoute roles={['admin']}><PageErrorBoundary><ModelsGenerate /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="models/catalogo" element={<ProtectedRoute roles={['admin']}><PageErrorBoundary><ModelsCatalog /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="generate" element={<ProtectedRoute roles={['admin', 'operador']}><PageErrorBoundary><Wizard /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="cola" element={<ProtectedRoute roles={['admin', 'operador', 'revisor']}><PageErrorBoundary><Cola /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="analytics" element={<ProtectedRoute roles={['admin', 'revisor']}><PageErrorBoundary><Analytics /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="finanzas" element={<ProtectedRoute roles={['admin']}><PageErrorBoundary><Finanzas /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="configuracion" element={<ProtectedRoute roles={['admin']}><PageErrorBoundary><Configuracion /></PageErrorBoundary></ProtectedRoute>} />
            <Route path="catalogo" element={<ProtectedRoute roles={['admin', 'operador', 'revisor']}><PageErrorBoundary><Catalogo /></PageErrorBoundary></ProtectedRoute>} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};
