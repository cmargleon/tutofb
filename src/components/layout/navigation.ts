import {
  BarChart3,
  DollarSign,
  Images,
  LayoutDashboard,
  Rows3,
  Settings,
  Shield,
  SlidersHorizontal,
  UserSquare2,
  Users,
  Wand2,
  type LucideIcon,
} from 'lucide-react';

export interface NavigationRole {
  isActive: boolean;
  canCreateBatches: boolean;
  canEvaluate: boolean;
  canManageClients: boolean;
  canManageModels: boolean;
  canAccessAnalytics: boolean;
  canAccessFinance: boolean;
  canManageUsers: boolean;
}

interface NavigationBase {
  name: string;
  icon: LucideIcon;
  visible: boolean;
}

export interface NavigationItem extends NavigationBase {
  type: 'item';
  path: string;
}

export interface NavigationGroup extends NavigationBase {
  type: 'group';
  defaultPath: string;
  children: NavigationItem[];
}

export type NavigationEntry = NavigationItem | NavigationGroup;

const isPathActive = (pathname: string, path: string) => {
  if (path === '/') {
    return pathname === '/';
  }

  return pathname === path || pathname.startsWith(`${path}/`);
};

export const buildNavigation = (role: NavigationRole): NavigationEntry[] => {
  const entries: NavigationEntry[] = [
    { type: 'item', name: 'Dashboard', path: '/', icon: LayoutDashboard, visible: role.isActive },
    { type: 'item', name: 'Generar Fotos', path: '/generate', icon: Wand2, visible: role.canCreateBatches },
    { type: 'item', name: 'Automatización', path: '/automation', icon: Rows3, visible: role.canCreateBatches },
    { type: 'item', name: 'Catálogo', path: '/catalogo', icon: Images, visible: role.canEvaluate },
    { type: 'item', name: 'Cola', path: '/cola', icon: Rows3, visible: role.canEvaluate },
    {
      type: 'group',
      name: 'Modelos',
      icon: UserSquare2,
      defaultPath: '/models/catalogo',
      visible: role.canManageModels,
      children: [
        { type: 'item', name: 'Generar', path: '/models/generar', icon: Wand2, visible: role.canManageModels },
        { type: 'item', name: 'Catálogo', path: '/models/catalogo', icon: Images, visible: role.canManageModels },
      ],
    },
    {
      type: 'group',
      name: 'Clientes',
      icon: Users,
      defaultPath: '/clients/crear',
      visible: role.canManageClients,
      children: [
        { type: 'item', name: 'Crear', path: '/clients/crear', icon: Users, visible: role.canManageClients },
        { type: 'item', name: 'Lista de Clientes', path: '/clients/lista', icon: Users, visible: role.canManageClients },
      ],
    },
    {
      type: 'group',
      name: 'Usuarios',
      icon: Shield,
      defaultPath: '/users/crear',
      visible: role.canManageUsers,
      children: [
        { type: 'item', name: 'Crear', path: '/users/crear', icon: Shield, visible: role.canManageUsers },
        { type: 'item', name: 'Lista de Usuarios', path: '/users/lista', icon: Shield, visible: role.canManageUsers },
      ],
    },
    {
      type: 'group',
      name: 'Sistema',
      icon: SlidersHorizontal,
      defaultPath: '/analytics',
      visible: role.canAccessAnalytics || role.canAccessFinance || role.canManageUsers,
      children: [
        { type: 'item', name: 'Analíticas', path: '/analytics', icon: BarChart3, visible: role.canAccessAnalytics },
        { type: 'item', name: 'Finanzas', path: '/finanzas', icon: DollarSign, visible: role.canAccessFinance },
        { type: 'item', name: 'Configuración', path: '/configuracion', icon: Settings, visible: role.canManageUsers },
      ],
    },
  ];

  return entries.reduce<NavigationEntry[]>((accumulator, entry) => {
    if (!entry.visible) {
      return accumulator;
    }

    if (entry.type === 'group') {
      const children = entry.children.filter((child) => child.visible);
      if (children.length === 0) {
        return accumulator;
      }

      accumulator.push({ ...entry, children });
      return accumulator;
    }

    accumulator.push(entry);
    return accumulator;
  }, []);
};

export const isNavigationEntryActive = (pathname: string, entry: NavigationEntry) => {
  if (entry.type === 'group') {
    return entry.children.some((child) => isPathActive(pathname, child.path));
  }

  return isPathActive(pathname, entry.path);
};

export const getCurrentPageTitle = (pathname: string, entries: NavigationEntry[]) => {
  for (const entry of entries) {
    if (entry.type === 'group') {
      const activeChild = entry.children.find((child) => isPathActive(pathname, child.path));
      if (activeChild) {
        return `${entry.name} / ${activeChild.name}`;
      }
      continue;
    }

    if (isPathActive(pathname, entry.path)) {
      return entry.name;
    }
  }

  return '';
};
