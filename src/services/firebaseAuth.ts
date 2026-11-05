import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User, 
  signOut 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

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
      userEmail: user.email || '',
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

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // Pre-seed cached access token from stored 1-hour session if available
  const storedSession = getStoredSession();
  if (storedSession && !cachedAccessToken) {
    cachedAccessToken = storedSession.accessToken;
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const session = getStoredSession();
      const token = cachedAccessToken || session?.accessToken;
      if (token) {
        cachedAccessToken = token;
        if (onAuthSuccess) onAuthSuccess(user, token);
      } else if (!isSigningIn) {
        // Token expired or not stored
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
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google sign in');
    }

    cachedAccessToken = credential.accessToken;
    saveSession(cachedAccessToken, result.user);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!cachedAccessToken) {
    const session = getStoredSession();
    if (session) cachedAccessToken = session.accessToken;
  }
  return cachedAccessToken;
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  clearSession();
};

