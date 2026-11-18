import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

export const AUTHORIZED_ADMIN_EMAILS = [
  'ishaidry@gmail.com',
  'burhanplumber52@gmail.com',
  'sajjadhusainlightwala@gmail.com',
] as const;

export const getUserEmail = (user?: User | null): string => {
  if (!user) return '';
  const email = user.email || user.providerData?.find((p) => p?.email)?.email || '';
  return email.trim().toLowerCase();
};

export const isAuthorizedAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;
  return AUTHORIZED_ADMIN_EMAILS.includes(
    email.trim().toLowerCase() as (typeof AUTHORIZED_ADMIN_EMAILS)[number]
  );
};

const createScopedProvider = () => {
  const provider = new GoogleAuthProvider();
  SCOPES.forEach((scope) => provider.addScope(scope));
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
};

const createBasicProvider = () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
};

const SESSION_STORAGE_KEY = 'faize_google_session_v1';
export const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour

export interface StoredSession {
  accessToken: string;
  loginTime: number;
  userEmail: string;
  userDisplayName?: string;
  userPhotoURL?: string;
}

export const getStoredSession = (): StoredSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session: StoredSession = JSON.parse(raw);
    const elapsed = Date.now() - session.loginTime;
    if (elapsed >= ONE_HOUR_MS) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
};

export const saveSession = (accessToken: string, user: User) => {
  try {
    const session: StoredSession = {
      accessToken,
      loginTime: Date.now(),
      userEmail: getUserEmail(user),
      userDisplayName: user.displayName || undefined,
      userPhotoURL: user.photoURL || undefined,
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (e) {
    console.warn('Could not save auth session:', e);
  }
};

export const clearSession = () => {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
};

export const getSessionRemainingMs = (): number => {
  const session = getStoredSession();
  if (!session) return 0;
  const elapsed = Date.now() - session.loginTime;
  return Math.max(0, ONE_HOUR_MS - elapsed);
};

let isSigningIn = false;
let cachedAccessToken: string | null = null;

const formatSignInError = (error: any): Error => {
  const code = error?.code || '';
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  if (code === 'auth/unauthorized-domain') {
    return new Error(
      `Sign-in is not enabled for this domain (${host}). Add "${host}" under Firebase Authentication → Settings → Authorized domains.`
    );
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return new Error(
      'Sign-in popup was closed before completing. If Google showed "Access blocked / Error 403", add this Gmail ID to Google Cloud OAuth Consent Screen → Test users.'
    );
  }
  if (code === 'auth/popup-blocked') {
    return new Error(
      'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.'
    );
  }
  if (code === 'auth/operation-not-allowed') {
    return new Error('Google Sign-In is not enabled in Firebase Authentication.');
  }
  return error instanceof Error ? error : new Error(error?.message || 'Google sign-in failed.');
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // Pre-seed cached access token from stored 1-hour session if available
  const storedSession = getStoredSession();
  if (storedSession && cachedAccessToken === null) {
    cachedAccessToken = storedSession.accessToken || '';
  }

  // Handle redirect-based Google login fallback (e.g. mobile browsers where popups are blocked)
  getRedirectResult(auth)
    .then((result) => {
      if (result?.user) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const token = credential?.accessToken || '';
        cachedAccessToken = token;
        saveSession(token, result.user);
        if (onAuthSuccess) onAuthSuccess(result.user, token);
      }
    })
    .catch((err) => {
      console.warn('Redirect sign-in check warning:', err);
    });

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const email = getUserEmail(user);
      const session = getStoredSession();
      const matchingSession =
        session && (!session.userEmail || session.userEmail.toLowerCase() === email)
          ? session
          : null;

      if (cachedAccessToken !== null) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (matchingSession) {
        cachedAccessToken = matchingSession.accessToken || '';
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // Session expired or not present
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      clearSession();
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    let result;
    try {
      result = await signInWithPopup(auth, createScopedProvider());
    } catch (scopedErr: any) {
      const code = scopedErr?.code || '';
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, createScopedProvider());
        return null;
      }
      // If Workspace scopes fail due to consent/internal OAuth rejection, retry with basic Google sign-in
      if (
        code !== 'auth/popup-closed-by-user' &&
        code !== 'auth/cancelled-popup-request' &&
        code !== 'auth/unauthorized-domain' &&
        code !== 'auth/operation-not-allowed'
      ) {
        try {
          result = await signInWithPopup(auth, createBasicProvider());
        } catch {
          throw scopedErr;
        }
      } else {
        throw scopedErr;
      }
    }

    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken || '';

    cachedAccessToken = token;
    saveSession(token, result.user);
    return { user: result.user, accessToken: token };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw formatSignInError(error);
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken === null) {
    const session = getStoredSession();
    if (session) cachedAccessToken = session.accessToken || '';
  }
  return cachedAccessToken || null;
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  clearSession();
};
