import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    const props = (this as any).props as Props;
    if (this.state.hasError && this.state.error) {
      if (props.fallback) {
        return props.fallback(this.state.error);
      }
      return (
        <div className="p-4 bg-red-50 text-red-900 border border-red-200 rounded-md m-4">
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <pre className="text-sm whitespace-pre-wrap overflow-auto">
            {this.state.error.message}
          </pre>
        </div>
      );
    }

    return props.children;
  }
}
