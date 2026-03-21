import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export const ThemeToggle: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      onClick={toggleTheme}
      className={`fixed right-4 top-4 z-[80] inline-flex h-12 w-[5.75rem] items-center rounded-full border p-1 shadow-lg backdrop-blur transition-all duration-300 sm:right-6 sm:top-6 ${
        isDark
          ? 'border-slate-700/80 bg-slate-950/85 text-slate-100 shadow-slate-950/35'
          : 'border-slate-200/90 bg-white/90 text-slate-700 shadow-slate-300/40'
      }`}
    >
      <span
        className={`absolute left-1 top-1 h-10 w-10 rounded-full shadow-md transition-transform duration-300 ${
          isDark ? 'translate-x-11 bg-indigo-500' : 'translate-x-0 bg-amber-400'
        }`}
        aria-hidden="true"
      />
      <span className={`relative z-10 flex w-1/2 justify-center transition-colors ${isDark ? 'text-slate-500' : 'text-white'}`}>
        <Sun className="h-4 w-4" />
      </span>
      <span className={`relative z-10 flex w-1/2 justify-center transition-colors ${isDark ? 'text-white' : 'text-slate-400'}`}>
        <Moon className="h-4 w-4" />
      </span>
    </button>
  );
};
