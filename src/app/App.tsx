import React, { useEffect, useState } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { ErrorBoundary } from '../ErrorBoundary';
import { AuthProvider } from '../features/auth/AuthProvider';
import { AppRouter } from './AppRouter';

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </ErrorBoundary>
  );
}
