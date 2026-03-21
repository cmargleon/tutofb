import { ErrorBoundary } from '../ErrorBoundary';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ThemeProvider } from '../features/theme/ThemeProvider';
import { ThemeToggle } from '../features/theme/ThemeToggle';
import { AppRouter } from './AppRouter';

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <ThemeToggle />
          <AppRouter />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
