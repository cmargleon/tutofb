import type { Browser, BrowserContext, BrowserContextOptions, BrowserType, Page } from '@playwright/test';

export interface IsolatedFrontend {
  baseURL: string;
  nonce: string;
  close: () => Promise<void>;
}

export interface IsolatedBrowser {
  page: Page;
  context: BrowserContext;
  baseURL: string;
  close: () => Promise<void>;
}

export interface OpenIsolatedBrowserOptions extends BrowserContextOptions {
  /** Keep the real AuthProvider instead of the admin fixture identity. */
  realAuth?: boolean;
}

export function requireLoopback(value: string): URL;
export function startIsolatedFrontend(options?: { realAuth?: boolean }): Promise<IsolatedFrontend>;
export function createIsolatedContext(
  browser: Browser,
  frontend: Pick<IsolatedFrontend, 'baseURL' | 'nonce'>,
  options?: BrowserContextOptions,
): Promise<BrowserContext>;
export function openIsolatedBrowser(chromium: BrowserType, options?: OpenIsolatedBrowserOptions): Promise<IsolatedBrowser>;
