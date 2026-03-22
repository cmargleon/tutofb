import { ErrorBoundary } from '../ErrorBoundary';
import { AuthProvider } from '../features/auth/AuthProvider';
import { FeedbackProvider } from '../features/feedback/FeedbackProvider';
import { ThemeProvider } from '../features/theme/ThemeProvider';
import { ThemeToggle } from '../features/theme/ThemeToggle';
import { AppRouter } from './AppRouter';

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <FeedbackProvider>
          <AuthProvider>
            <ThemeToggle />
            <AppRouter />
          </AuthProvider>
        </FeedbackProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
