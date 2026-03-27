import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Archive,
  BarChart3,
  Eye,
  Images,
  LayoutDashboard,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Settings,
  Shield,
  Sun,
  UserSquare2,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { useAuth, useRole } from '../../features/auth/AuthProvider';
import { useTheme } from '../../features/theme/ThemeProvider';
import { auth } from '../../firebase';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

interface SidebarProps {
  isDesktop: boolean;
  isSidebarCollapsed: boolean;
  isMobileMenuOpen: boolean;
  onToggleSidebar: () => void;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isDesktop,
  isSidebarCollapsed,
  isMobileMenuOpen,
  onToggleSidebar,
  onCloseMobile,
}) => {
  const { appUser } = useAuth();
  const role = useRole();
  const location = useLocation();
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();

  const navItems = [
    { name: 'Dashboard',   path: '/',          icon: LayoutDashboard, visible: role.isActive           },
    { name: 'Generar',     path: '/generate',   icon: Wand2,           visible: role.canCreateBatches  },
    { name: 'Cola',        path: '/cola',       icon: Rows3,           visible: role.canEvaluate        },
    { name: 'Evaluación',  path: '/evaluacion', icon: Eye,             visible: role.canEvaluate        },
    { name: 'Clientes',    path: '/clients',    icon: Users,           visible: role.canManageClients   },
    { name: 'Modelos',     path: '/models',     icon: UserSquare2,     visible: role.canManageModels    },
    { name: 'Archivo',     path: '/archivo',    icon: Archive,         visible: role.canAccessArchive   },
    { name: 'Catálogo',    path: '/catalogo',   icon: Images,          visible: role.canEvaluate        },
    { name: 'Analíticas',  path: '/analytics',  icon: BarChart3,       visible: role.canAccessAnalytics },
    { name: 'Usuarios',       path: '/users',         icon: Shield,    visible: role.canManageUsers     },
    { name: 'Configuración',  path: '/configuracion', icon: Settings,  visible: role.canManageUsers     },
  ];

  const filteredNav = navItems.filter((item) => item.visible);
  const collapsed = isDesktop && isSidebarCollapsed;

  const isActiveRoute = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const sidebarWidthClass = isSidebarCollapsed ? 'xl:w-20' : 'xl:w-64';

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white border-r border-gray-200 transition-transform duration-200 xl:static xl:translate-x-0 xl:transition-[width] ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      } ${sidebarWidthClass}`}
    >
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
            onClick={onCloseMobile}
            className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label={isSidebarCollapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </button>
        )}
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
              <item.icon className={`w-5 h-5 shrink-0 ${active ? 'text-indigo-600' : ''}`} />
              {!collapsed ? <span>{item.name}</span> : null}
              {active && !collapsed ? (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-600" aria-hidden="true" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer: theme toggle + user + logout */}
      <div className="p-3 border-t border-gray-200 space-y-0.5">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 ${
            collapsed ? 'justify-center' : 'gap-3'
          }`}
        >
          {isDark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
          {!collapsed ? <span>{isDark ? 'Tema claro' : 'Tema oscuro'}</span> : null}
        </button>

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
    </aside>
  );
};
