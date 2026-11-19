/**
 * Google OAuth 2.0 for a service account, without the google-auth library: a self-signed RS256 JWT
 * assertion (RFC 7523) exchanged at the token endpoint for an access token. Tokens are cached and
 * refreshed five minutes before they expire; concurrent callers share one in-flight refresh.
 */
import { fetchJson, Rejected, withTransportRetry } from './http.js';
import type { ServiceAccountKey } from './credentials.js';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

function b64url(input: Uint8Array | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/u, '').replace(/\+/gu, '-').replace(/\//gu, '_');
}

/** PEM (PKCS#8, as in Google key files) -> a Web Crypto RS256 signing key. */
async function signingKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/gu, '').replace(/\s+/gu, '');
  return globalThis.crypto.subtle.importKey('pkcs8', Buffer.from(body, 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/**
 * The signed JWT assertion for `key`, valid for one hour from `nowSec`. Uses Web Crypto, so it runs the same
 * on Node and on Cloudflare Workers.
 */
export async function signAssertion(key: ServiceAccountKey, scope: string, nowSec: number): Promise<string> {
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (key.private_key_id) header.kid = key.private_key_id;
  const claims = {
    iss: key.client_email,
    scope,
    aud: key.token_uri || DEFAULT_TOKEN_URI,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(key.private_key),
    new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}

export class GoogleTokenSource {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;

  constructor(private readonly key: ServiceAccountKey, private readonly scope = SHEETS_SCOPE,
    private readonly now: () => number = Date.now) {}

  get account(): string {
    return this.key.client_email;
  }

  async getToken(): Promise<string> {
    if (this.token && this.now() < this.expiresAt - 5 * 60_000) return this.token;
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Forget the cached token (after a 401 from an API). */
  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  private async refresh(): Promise<string> {
    const assertion = await signAssertion(this.key, this.scope, Math.floor(this.now() / 1000));
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString();
    let res;
    try {
      res = await withTransportRetry(() => fetchJson<{ access_token?: string; expires_in?: number }>(
        this.key.token_uri || DEFAULT_TOKEN_URI,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, timeoutMs: 30_000 }));
    } catch (err) {
      if (err instanceof Rejected) {
        throw new Rejected(`Google refused the service-account sign-in (${err.message}); check the key is current`, err.status);
      }
      throw err;
    }
    const token = res.body?.access_token;
    if (!token) throw new Rejected('Google token endpoint returned no access_token');
    this.token = token;
    this.expiresAt = this.now() + (Number(res.body.expires_in) || 3600) * 1000;
    return token;
  }
}
