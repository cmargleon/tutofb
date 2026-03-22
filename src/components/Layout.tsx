import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useRole } from '../features/auth/AuthProvider';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import {
  LayoutDashboard,
  Users,
  UserSquare2,
  Wand2,
  Archive,
  Eye,
  Rows3,
  BarChart3,
  Shield,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';

export const Layout: React.FC = () => {
  const { appUser } = useAuth();
  const role = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1280);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 1280);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)');
    const syncLayoutMode = (matches: boolean) => {
      setIsDesktop(matches);
      setIsSidebarCollapsed(!matches);
      setIsMobileMenuOpen(false);
    };

    syncLayoutMode(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      syncLayoutMode(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      setIsMobileMenuOpen(false);
    }
  }, [location.pathname, isDesktop]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, visible: role.isActive },
    { name: 'Usuarios', path: '/users', icon: Shield, visible: role.canManageUsers },
    { name: 'Clientes', path: '/clients', icon: Users, visible: role.canManageClients },
    { name: 'Modelos', path: '/models', icon: UserSquare2, visible: role.canManageModels },
    { name: 'Generar', path: '/generate', icon: Wand2, visible: role.canCreateBatches },
    { name: 'Cola', path: '/cola', icon: Rows3, visible: role.canEvaluate },
    { name: 'Evaluación', path: '/evaluacion', icon: Eye, visible: role.canEvaluate },
    { name: 'Archivo', path: '/archivo', icon: Archive, visible: role.canAccessArchive },
    { name: 'Analíticas', path: '/analytics', icon: BarChart3, visible: role.canAccessAnalytics },
  ];

  const filteredNav = navItems.filter(item => item.visible);
  const sidebarWidthClass = isSidebarCollapsed ? 'xl:w-20' : 'xl:w-64';
  const shellStyle = {
    ['--app-sidebar-width' as const]: isDesktop ? (isSidebarCollapsed ? '5rem' : '16rem') : '0rem',
  } as React.CSSProperties;

  const renderSidebarContent = (collapsed: boolean) => (
    <>
      <div className="flex items-center justify-between p-4 border-b border-gray-200 min-h-[73px]">
        <div className="min-w-0">
          <h1 className={`font-bold text-indigo-600 ${collapsed ? 'text-base' : 'text-xl'}`}>
            {collapsed ? 'VT' : 'Virtual Try-On'}
          </h1>
        </div>
        {!isDesktop ? (
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {filteredNav.map((item) => (
          <Link
            key={item.name}
            to={item.path}
            title={collapsed ? item.name : undefined}
            className={`flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-indigo-600 ${
              collapsed ? 'justify-center' : 'gap-3'
            }`}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {!collapsed ? <span>{item.name}</span> : null}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-200">
        <div className={`mb-4 flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold shrink-0">
            {appUser?.displayName?.charAt(0) || 'A'}
          </div>
          {!collapsed ? (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{appUser?.displayName || 'Admin User'}</p>
              <p className="text-xs text-gray-500 truncate capitalize">{appUser?.role || 'sin rol'}</p>
            </div>
          ) : null}
        </div>
        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign Out' : undefined}
          className={`flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-red-600 ${
            collapsed ? 'justify-center' : 'gap-2'
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed ? <span>Sign Out</span> : null}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" style={shellStyle}>
      {!isDesktop && isMobileMenuOpen ? (
        <div
          className="fixed inset-0 z-40 bg-gray-900/40 xl:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white border-r border-gray-200 transition-transform duration-200 xl:static xl:translate-x-0 xl:transition-[width] ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } ${sidebarWidthClass}`}
      >
        {renderSidebarContent(isDesktop && isSidebarCollapsed)}
      </aside>

      <main className="flex-1 overflow-auto min-w-0">
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 xl:px-6">
          <button
            type="button"
            onClick={() => (isDesktop ? setIsSidebarCollapsed((value) => !value) : setIsMobileMenuOpen(true))}
            className="inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label={isDesktop ? 'Colapsar menú lateral' : 'Abrir menú lateral'}
          >
            {isDesktop ? (
              isSidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>
        <div className="p-4 sm:p-6 xl:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
