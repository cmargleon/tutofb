import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1280px)';

export const useResponsiveSidebar = () => {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1280);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 1280);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_QUERY);
    const syncLayoutMode = (matches: boolean) => {
      setIsDesktop(matches);
      setIsSidebarCollapsed(!matches);
      setIsMobileMenuOpen(false);
    };

    syncLayoutMode(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => syncLayoutMode(event.matches);
    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return {
    isDesktop,
    isSidebarCollapsed,
    isMobileMenuOpen,
    setIsSidebarCollapsed,
    setIsMobileMenuOpen,
  };
};
