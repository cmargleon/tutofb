import React from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth, useRole } from '../features/auth/AuthProvider';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { LayoutDashboard, Users, UserSquare2, Wand2, Archive, Eye, BarChart3, LogOut } from 'lucide-react';

export const Layout: React.FC = () => {
  const { appUser } = useAuth();
  const role = useRole();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, visible: role.isActive },
    { name: 'Clientes', path: '/clients', icon: Users, visible: role.canManageClients },
    { name: 'Modelos', path: '/models', icon: UserSquare2, visible: role.canManageModels },
    { name: 'Generar', path: '/generate', icon: Wand2, visible: role.canCreateBatches },
    { name: 'Evaluación', path: '/evaluacion', icon: Eye, visible: role.canEvaluate },
    { name: 'Archivo', path: '/archivo', icon: Archive, visible: role.canAccessArchive },
    { name: 'Analíticas', path: '/analytics', icon: BarChart3, visible: role.canAccessAnalytics },
  ];

  const filteredNav = navItems.filter(item => item.visible);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-indigo-600">Virtual Try-On</h1>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {filteredNav.map((item) => (
            <Link
              key={item.name}
              to={item.path}
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-indigo-600 transition-colors"
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold">
              {appUser?.displayName?.charAt(0) || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{appUser?.displayName || 'Admin User'}</p>
              <p className="text-xs text-gray-500 truncate capitalize">{appUser?.role || 'sin rol'}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-100 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
