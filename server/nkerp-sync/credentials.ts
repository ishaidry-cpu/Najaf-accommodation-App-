/**
 * Where the NKERP login and the Google service-account key come from. Server-side only: these values
 * never reach the browser, are never logged, and are never written to disk by the app.
 *
 *   NKERP login            NKERP_LOGIN_ID + NKERP_PASSWORD
 *   Google service account GOOGLE_SERVICE_ACCOUNT_JSON (the key file's JSON text, or base64 of it)
 *                          or GOOGLE_SERVICE_ACCOUNT_FILE (a path to the key file)
 *   Sheet (optional)       NAJAF_SHEET_ID (defaults to the Faiz Husaini Zaereen Accommodation sheet)
 */
import fs from 'fs';

export class MissingCredentials extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingCredentials';
  }
}

export interface ServiceAccountKey {
  type?: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
  project_id?: string;
}

export function nkerpLogin(env: NodeJS.ProcessEnv = process.env): { loginId: string; password: string } {
  const loginId = env.NKERP_LOGIN_ID?.trim();
  const password = env.NKERP_PASSWORD;
  if (!loginId || !password) {
    throw new MissingCredentials('NKERP login is not configured on the server (set NKERP_LOGIN_ID and NKERP_PASSWORD)');
  }
  return { loginId, password };
}

function parseKey(text: string, source: string): ServiceAccountKey {
  let raw = text.trim();
  if (!raw.startsWith('{')) {
    // Accept base64 so the key can live in a single-line secret.
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
      if (decoded.startsWith('{')) raw = decoded;
    } catch {
      /* fall through to the JSON error */
    }
  }
  let key: ServiceAccountKey;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new MissingCredentials(`${source} is not valid JSON`);
  }
  if (!key || typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
    throw new MissingCredentials(`${source} lacks client_email or private_key`);
  }
  // Keys pasted into env editors often arrive with literal "\n" sequences.
  if (!key.private_key.includes('\n') && key.private_key.includes('\\n')) {
    key = { ...key, private_key: key.private_key.replace(/\\n/g, '\n') };
  }
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----/.test(key.private_key)) {
    throw new MissingCredentials(`${source} has no usable private_key (paste the whole key file, from { to })`);
  }
  return key;
}

export function googleServiceAccount(env: NodeJS.ProcessEnv = process.env): ServiceAccountKey {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    return parseKey(env.GOOGLE_SERVICE_ACCOUNT_JSON, 'GOOGLE_SERVICE_ACCOUNT_JSON');
  }
  const file = env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();
  if (file) {
    if (!fs.existsSync(file)) throw new MissingCredentials('GOOGLE_SERVICE_ACCOUNT_FILE points to a missing file');
    return parseKey(fs.readFileSync(file, 'utf8'), 'GOOGLE_SERVICE_ACCOUNT_FILE');
  }
  throw new MissingCredentials(
    'Google service account is not configured on the server (set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE)');
}

/** Booleans only: safe to show in the UI. */
export function credentialStatus(env: NodeJS.ProcessEnv = process.env): {
  nkerp: boolean; google: boolean; googleAccount: string | null; problem: string | null;
} {
  let nkerp = false;
  let google = false;
  let googleAccount: string | null = null;
  const problems: string[] = [];
  try {
    nkerpLogin(env);
    nkerp = true;
  } catch (e) {
    problems.push((e as Error).message);
  }
  try {
    const key = googleServiceAccount(env);
    google = true;
    googleAccount = key.client_email;      // the address staff share the Sheet with; not a secret
  } catch (e) {
    problems.push((e as Error).message);
  }
  return { nkerp, google, googleAccount, problem: problems.length ? problems.join('; ') : null };
}
