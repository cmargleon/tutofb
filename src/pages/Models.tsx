import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export const Models: React.FC = () => {
  const location = useLocation();

  return <Navigate replace to={`/models/catalogo${location.search}${location.hash}`} />;
};
