import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  X,
} from 'lucide-react';
import { useAuth, useRole } from '../../features/auth/AuthProvider';
import { useTheme } from '../../features/theme/ThemeProvider';
import { auth } from '../../firebase';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { buildNavigation, isNavigationEntryActive, type NavigationGroup } from './navigation';

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
  const navigation = buildNavigation(role);
  const collapsed = isDesktop && isSidebarCollapsed;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenGroups((current) => {
      let didChange = false;
      const next = { ...current };

      navigation.forEach((entry) => {
        if (entry.type === 'group' && isNavigationEntryActive(location.pathname, entry) && !next[entry.name]) {
          next[entry.name] = true;
          didChange = true;
        }
      });

      return didChange ? next : current;
    });
  }, [location.pathname, navigation]);

  const toggleGroup = (group: NavigationGroup) => {
    if (collapsed) {
      onToggleSidebar();
      setOpenGroups((current) => ({ ...current, [group.name]: true }));
      return;
    }

    setOpenGroups((current) => ({
      ...current,
      [group.name]: !(current[group.name] ?? isNavigationEntryActive(location.pathname, group)),
    }));
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
        {navigation.map((entry) => {
          const active = isNavigationEntryActive(location.pathname, entry);

          if (entry.type === 'group') {
            const isOpen = !collapsed && (openGroups[entry.name] ?? active);

            return (
              <div key={entry.name} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(entry)}
                  title={collapsed ? entry.name : undefined}
                  className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    collapsed ? 'justify-center' : 'gap-3'
                  } ${
                    active
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                  aria-expanded={isOpen}
                >
                  <entry.icon className={`w-5 h-5 shrink-0 ${active ? 'text-indigo-600' : ''}`} />
                  {!collapsed ? <span>{entry.name}</span> : null}
                  {!collapsed ? (
                    isOpen ? (
                      <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
                    )
                  ) : null}
                </button>

                {isOpen ? (
                  <div className="space-y-1 pl-11">
                    {entry.children.map((child) => {
                      const childActive = isNavigationEntryActive(location.pathname, child);

                      return (
                        <Link
                          key={child.path}
                          to={child.path}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                            childActive
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              childActive ? 'bg-indigo-600' : 'bg-gray-300'
                            }`}
                            aria-hidden="true"
                          />
                          <span>{child.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <Link
              key={entry.path}
              to={entry.path}
              title={collapsed ? entry.name : undefined}
              className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                collapsed ? 'justify-center' : 'gap-3'
              } ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <entry.icon className={`w-5 h-5 shrink-0 ${active ? 'text-indigo-600' : ''}`} />
              {!collapsed ? <span>{entry.name}</span> : null}
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
