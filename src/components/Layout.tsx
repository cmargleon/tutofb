import React, { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useRole } from '../features/auth/AuthProvider';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useTheme } from '../features/theme/ThemeProvider';
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
  Sun,
  Moon,
  Bell,
} from 'lucide-react';
import { AnalyticsSummary, Job } from '../../shared/src/types';
import { StatusBadge } from './ui';

export const Layout: React.FC = () => {
  const { appUser } = useAuth();
  const role = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1280);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 1280);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Topbar state
  const [queueCount, setQueueCount] = useState(0);
  const [notifications, setNotifications] = useState<Job[]>([]);
  const [notifSeenAt, setNotifSeenAt] = useState(() => {
    const stored = localStorage.getItem('notifSeenAt');
    return stored ? parseInt(stored, 10) : 0;
  });
  const sessionStartRef = useRef(Date.now());
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

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

  // Firebase subscriptions: queue count + notifications
  useEffect(() => {
    const unsubQueue = onSnapshot(doc(db, 'analytics_summary', 'global'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as AnalyticsSummary;
        setQueueCount((data.pendingJobs ?? 0) + (data.processingJobs ?? 0));
      } else {
        setQueueCount(0);
      }
    });

    const unsubNotif = onSnapshot(
      query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(30)),
      (snap) => {
        const jobs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Job))
          .filter((j) => j.status === 'completed' || j.status === 'failed');
        setNotifications(jobs.slice(0, 8));
      },
    );

    return () => { unsubQueue(); unsubNotif(); };
  }, []);

  // Click-outside to close notification dropdown
  useEffect(() => {
    if (!isNotifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isNotifOpen]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard',   path: '/',          icon: LayoutDashboard, visible: role.isActive           },
    { name: 'Generar',     path: '/generate',   icon: Wand2,           visible: role.canCreateBatches  },
    { name: 'Cola',        path: '/cola',       icon: Rows3,           visible: role.canEvaluate        },
    { name: 'Evaluación',  path: '/evaluacion', icon: Eye,             visible: role.canEvaluate        },
    { name: 'Clientes',    path: '/clients',    icon: Users,           visible: role.canManageClients   },
    { name: 'Modelos',     path: '/models',     icon: UserSquare2,     visible: role.canManageModels    },
    { name: 'Archivo',     path: '/archivo',    icon: Archive,         visible: role.canAccessArchive   },
    { name: 'Analíticas',  path: '/analytics',  icon: BarChart3,       visible: role.canAccessAnalytics },
    { name: 'Usuarios',    path: '/users',      icon: Shield,          visible: role.canManageUsers     },
  ];

  const filteredNav = navItems.filter((item) => item.visible);
  const sidebarWidthClass = isSidebarCollapsed ? 'xl:w-20' : 'xl:w-64';
  const shellStyle = {
    ['--app-sidebar-width' as const]: isDesktop ? (isSidebarCollapsed ? '5rem' : '16rem') : '0rem',
  } as React.CSSProperties;

  const isActiveRoute = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const currentPageTitle = navItems.find((item) => isActiveRoute(item.path))?.name ?? '';

  const unreadCount = notifications.filter((j) => {
    const ms = j.createdAt && typeof (j.createdAt as any).toMillis === 'function'
      ? (j.createdAt as any).toMillis()
      : 0;
    return ms > Math.max(sessionStartRef.current, notifSeenAt);
  }).length;

  const handleBellClick = () => {
    setIsNotifOpen((open) => !open);
    const now = Date.now();
    setNotifSeenAt(now);
    localStorage.setItem('notifSeenAt', String(now));
  };

  const renderSidebarContent = (collapsed: boolean) => (
    <>
      {/* Logo */}
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
            className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        ) : null}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {filteredNav.map((item) => {
          const active = isActiveRoute(item.path);
          return (
            <Link
              key={item.name}
              to={item.path}
              title={collapsed ? item.name : undefined}
              className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                collapsed ? 'justify-center' : 'gap-3'
              } ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <item.icon
                className={`w-5 h-5 shrink-0 ${active ? 'text-indigo-600' : ''}`}
              />
              {!collapsed ? <span>{item.name}</span> : null}
              {active && !collapsed ? (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-600" aria-hidden="true" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer: user + theme toggle + logout */}
      <div className="p-3 border-t border-gray-200 space-y-0.5">
        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 ${
            collapsed ? 'justify-center' : 'gap-3'
          }`}
        >
          {isDark ? (
            <Sun className="w-4 h-4 shrink-0" />
          ) : (
            <Moon className="w-4 h-4 shrink-0" />
          )}
          {!collapsed ? <span>{isDark ? 'Tema claro' : 'Tema oscuro'}</span> : null}
        </button>

        {/* User info */}
        <div className={`flex items-center px-3 py-2 ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 text-xs font-bold shrink-0">
            {appUser?.displayName?.charAt(0) || 'A'}
          </div>
          {!collapsed ? (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{appUser?.displayName || 'Admin User'}</p>
              <p className="text-xs text-gray-500 truncate capitalize">{appUser?.role || 'sin rol'}</p>
            </div>
          ) : null}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Cerrar sesión' : undefined}
          className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 ${
            collapsed ? 'justify-center' : 'gap-2'
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed ? <span>Cerrar sesión</span> : null}
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
          {/* Left */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (isDesktop ? setIsSidebarCollapsed((value) => !value) : setIsMobileMenuOpen(true))}
              className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              aria-label={isDesktop ? 'Colapsar menú lateral' : 'Abrir menú lateral'}
            >
              {isDesktop ? (
                isSidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
            <span className="hidden sm:block text-sm font-medium text-slate-700">
              {currentPageTitle}
            </span>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            {/* Nuevo lote */}
            {role.canCreateBatches && location.pathname !== '/generate' && (
              <Link
                to="/generate"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 transition"
              >
                <Wand2 className="w-4 h-4" /> Nuevo lote
              </Link>
            )}

            {/* Queue indicator */}
            {queueCount > 0 && (
              <Link
                to="/cola"
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
              >
                <Rows3 className="w-3.5 h-3.5" /> {queueCount} en cola
              </Link>
            )}

            {/* Bell / Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={handleBellClick}
                className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Notificaciones"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {isNotifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 z-50 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                  {/* Header */}
                  <div className="border-b border-gray-100 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Notificaciones recientes</p>
                  </div>
                  {/* List */}
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-400">Sin notificaciones recientes</div>
                  ) : (
                    <ul className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                      {notifications.map((job) => (
                        <li key={job.id}>
                          <Link
                            to={`/evaluacion?batchId=${job.batchId}`}
                            onClick={() => setIsNotifOpen(false)}
                            className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-900">{job.garmentName}</p>
                              <p className="text-xs text-slate-500">{job.clientNameSnapshot} · {job.id?.slice(0, 8)}</p>
                            </div>
                            <StatusBadge status={job.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Footer */}
                  <div className="border-t border-gray-100 px-4 py-3">
                    <Link
                      to="/evaluacion"
                      onClick={() => setIsNotifOpen(false)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      Ver evaluación →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="p-4 sm:p-6 xl:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
