/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_FIREBASE_EMULATORS?: string;
  readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string;
  readonly VITE_APP_CHECK_DEBUG_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
