import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  X,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { useAuth, useRole } from '../../features/auth/AuthProvider';
import { useTheme } from '../../features/theme/ThemeProvider';
import { auth } from '../../firebase';
import { IconButton } from '../ui';
import {
  buildNavigation,
  isNavigationEntryActive,
  NAVIGATION_SECTION_LABELS,
  type NavigationGroup,
} from './navigation';

interface SidebarProps {
  isDesktop: boolean;
  isSidebarCollapsed: boolean;
  isMobileMenuOpen: boolean;
  onToggleSidebar: () => void;
  onCloseMobile: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  operador: 'Operador',
  revisor: 'Revisor',
};

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
  const sidebarRef = useRef<HTMLElement>(null);

  // Mobile drawer: focus trap, Escape to close, focus restoration.
  useEffect(() => {
    if (isDesktop || !isMobileMenuOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const sidebar = sidebarRef.current;
    const focusable = (): HTMLElement[] => sidebar ? Array.from(sidebar.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')) : [];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseMobile(); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    sidebar?.addEventListener('keydown', onKey);
    return () => { sidebar?.removeEventListener('keydown', onKey); previous?.focus({ preventScroll: true }); };
  }, [isDesktop, isMobileMenuOpen, onCloseMobile]);

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

  const sidebarWidthClass = isSidebarCollapsed ? 'xl:w-[4.25rem]' : 'xl:w-60';
  const displayName = appUser?.displayName || 'Usuario';
  const roleLabel = appUser?.role ? ROLE_LABELS[appUser.role] ?? appUser.role : 'Sin rol';
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join('').toLocaleUpperCase('es') || 'U';

  return (
    <aside
      ref={sidebarRef}
      aria-label="Menú principal"
      role={!isDesktop && isMobileMenuOpen ? 'dialog' : undefined}
      aria-modal={!isDesktop && isMobileMenuOpen ? true : undefined}
      inert={!isDesktop && !isMobileMenuOpen}
      className={`tuto-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r transition-transform duration-200 xl:static xl:translate-x-0 xl:transition-[width] ${
        isMobileMenuOpen ? 'translate-x-0 shadow-xl xl:shadow-none' : '-translate-x-full'
      } ${sidebarWidthClass}`}
    >
      {/* Brand */}
      <div className={`tuto-sidebar-head ${collapsed ? 'flex-col justify-center gap-1 px-0 py-2' : 'justify-between'}`}>
        <Link to="/" aria-label="Tuto · Inicio" className="flex min-w-0 items-center gap-2 rounded-md">
          <span className="tuto-brand-mark" aria-hidden="true">t</span>
          {!collapsed && <span className="tuto-brand">tuto<span className="tuto-brand-dot">.</span></span>}
        </Link>
        {!isDesktop ? (
          <IconButton label="Cerrar menú" icon={X} onClick={onCloseMobile} />
        ) : (
          <IconButton
            size="sm"
            label={isSidebarCollapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
            icon={isSidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
            onClick={onToggleSidebar}
          />
        )}
      </div>

      {/* Modules */}
      <nav aria-label="Módulos" className={`flex-1 overflow-y-auto pb-3 ${collapsed ? 'px-2.5' : 'px-3'}`}>
        <div className="tuto-nav">
          {navigation.map((entry, index) => {
            const active = isNavigationEntryActive(location.pathname, entry);
            const section = entry.section ?? 'home';
            const sectionLabel = NAVIGATION_SECTION_LABELS[section];
            const startsSection = index === 0 || (navigation[index - 1].section ?? 'home') !== section;
            const heading = startsSection && sectionLabel ? (
              collapsed
                ? <hr className="tuto-divider mx-2 my-2.5" aria-hidden="true" />
                : <p className="tuto-nav-label">{sectionLabel}</p>
            ) : null;

            if (entry.type === 'group') {
              const isOpen = !collapsed && (openGroups[entry.name] ?? active);

              return (
                <React.Fragment key={entry.name}>
                  {heading}
                  <button
                    type="button"
                    onClick={() => toggleGroup(entry)}
                    title={collapsed ? entry.name : undefined}
                    aria-label={entry.name}
                    aria-expanded={isOpen}
                    data-active={active || undefined}
                    className={`tuto-nav-link ${collapsed ? 'tuto-nav-link--collapsed' : ''}`}
                  >
                    <entry.icon aria-hidden="true" />
                    {!collapsed ? <span className="truncate">{entry.name}</span> : null}
                    {!collapsed ? <ChevronRight className="tuto-nav-chevron" aria-hidden="true" /> : null}
                  </button>

                  {isOpen ? (
                    <div className="tuto-nav-children">
                      {entry.children.map((child) => {
                        const childActive = isNavigationEntryActive(location.pathname, child);
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            aria-current={childActive ? 'page' : undefined}
                            className="tuto-nav-sublink"
                          >
                            <span className="truncate">{child.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={entry.path}>
                {heading}
                <Link
                  to={entry.path}
                  aria-label={entry.name}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? entry.name : undefined}
                  className={`tuto-nav-link ${collapsed ? 'tuto-nav-link--collapsed' : ''}`}
                >
                  <entry.icon aria-hidden="true" />
                  {!collapsed ? <span className="truncate">{entry.name}</span> : null}
                </Link>
              </React.Fragment>
            );
          })}
        </div>
      </nav>

      {/* Account */}
      <div className="tuto-sidebar-footer">
        {!collapsed ? (
          <div className="tuto-user-card">
            <span className="tuto-avatar tuto-avatar--round tuto-avatar--sm" aria-hidden="true">{initials}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{displayName}</p>
              <p className="truncate text-xs text-[var(--color-text-muted)]">{roleLabel}</p>
            </div>
          </div>
        ) : null}
        <div className={`mt-1 flex gap-1 ${collapsed ? 'flex-col items-center' : 'items-center'}`}>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            title={collapsed ? (isDark ? 'Tema claro' : 'Tema oscuro') : undefined}
            className={`tuto-nav-link ${collapsed ? 'tuto-nav-link--collapsed' : 'flex-1'}`}
          >
            {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            {!collapsed ? <span>{isDark ? 'Tema claro' : 'Tema oscuro'}</span> : null}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="tuto-nav-link tuto-nav-link--collapsed w-[2.125rem] hover:!bg-[var(--color-danger-soft)] hover:!text-[var(--color-danger)]"
          >
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
};
