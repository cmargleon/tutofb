import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import firebaseConfig from '../firebase-applet-config.json';

const appConfig = firebaseConfig as typeof firebaseConfig & { firestoreDatabaseId?: string };

const app = initializeApp(appConfig);

// App Check debe inicializarse antes de usar Functions/Firestore/Storage para que
// todas las llamadas adjunten el token. Sin site key no se inicializa (las callables
// siguen funcionando mientras ENFORCE_APP_CHECK=false en el backend).
const appCheckSiteKey = import.meta.env?.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
if (typeof window !== 'undefined' && appCheckSiteKey) {
  if (import.meta.env?.DEV) {
    // `true` hace que el SDK genere un debug token y lo imprima en la consola del
    // navegador; luego hay que registrarlo en Firebase Console > App Check.
    const debugToken = import.meta.env?.VITE_APP_CHECK_DEBUG_TOKEN;
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken || true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
} else if (typeof window !== 'undefined' && import.meta.env?.PROD) {
  console.warn('[AppCheck] VITE_RECAPTCHA_ENTERPRISE_SITE_KEY no está definida: App Check deshabilitado.');
}

export const db = appConfig.firestoreDatabaseId
  ? getFirestore(app, appConfig.firestoreDatabaseId)
  : getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

if (import.meta.env?.VITE_USE_FIREBASE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}
