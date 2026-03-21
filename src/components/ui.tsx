import React from 'react';
import { useStorageAssetUrl } from '../features/storage/useStorageAssetUrl';

interface PageHeaderProps {
  title: string;
  description?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description }) => {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      {description && <p className="mt-2 text-sm text-gray-600">{description}</p>}
    </div>
  );
};

export const LoadingBlock: React.FC = () => {
  return (
    <div className="flex justify-center items-center p-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
    </div>
  );
};

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon }) => {
  return (
    <div className="text-center p-12 bg-white rounded-xl border border-gray-100 shadow-sm">
      {icon && <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 text-indigo-600 mb-4">{icon}</div>}
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <p className="mt-2 text-sm text-gray-500">{description}</p>
    </div>
  );
};

interface ImageThumbProps {
  storagePath: string;
  alt?: string;
}

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'completed':
        return { bg: 'bg-green-100', text: 'text-green-800', label: 'Completado' };
      case 'processing':
        return { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Procesando' };
      case 'failed':
      case 'partial_failed':
        return { bg: 'bg-red-100', text: 'text-red-800', label: 'Fallido' };
      case 'pending':
      default:
        return { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pendiente' };
    }
  };

  const config = getStatusConfig();

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
};

export const ImageThumb: React.FC<ImageThumbProps> = ({ storagePath, alt = 'Thumbnail' }) => {
  const { url, loading } = useStorageAssetUrl(storagePath);

  if (loading) {
    return <div className="w-full h-full bg-gray-100 animate-pulse rounded-md" />;
  }

  if (!url) {
    return <div className="w-full h-full bg-gray-200 flex items-center justify-center text-xs text-gray-500 rounded-md">Error</div>;
  }

  return (
    <img 
      src={url} 
      alt={alt} 
      className="w-full h-full object-cover rounded-md border border-gray-200"
      referrerPolicy="no-referrer"
    />
  );
};
