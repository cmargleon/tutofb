import React from 'react';
import { ChevronDown } from 'lucide-react';

const INPUT_BASE =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400';

export const SelectField: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <div className="relative">
    <select
      {...props}
      className={`${INPUT_BASE} appearance-none pr-10 ${className}`.trim()}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
  </div>
);
