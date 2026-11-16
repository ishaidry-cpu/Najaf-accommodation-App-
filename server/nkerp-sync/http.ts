/**
 * HTTP primitives for the sync engine: one place that decides what is a *refusal* (the far side answered
 * and said no), what is a *transport* failure (we never got a usable answer: retry reads, never writes),
 * and how timeouts and outbound proxies are handled.
 */
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

/** NKERP (or Google) answered and refused the request: HTTP error status, or `IsError` in the body. */
export class Rejected extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'Rejected';
  }
}

/** The request never produced a usable answer (DNS, TLS, reset, timeout). Safe to retry for reads only. */
export class TransportError extends Error {
  constructor(message: string, readonly causeName: string) {
    super(message);
    this.name = causeName;               // 'TimeoutError', 'ConnectionError' ... (used in "X during save")
  }
}

/** An answer that is not the JSON object we expect. */
export class BadResponse extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JSONDecodeError';
  }
}

let proxyConfigured = false;

/**
 * Honour HTTPS_PROXY / HTTP_PROXY / NO_PROXY for every outbound call when they are set (corporate
 * networks, sandboxes). Node's built-in fetch ignores them by default. Idempotent.
 */
export function configureOutboundProxy(): void {
  if (proxyConfigured) return;
  proxyConfigured = true;
  const env = process.env;
  if (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}

export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  /** Extra signal (e.g. job cancellation) combined with the timeout. */
  signal?: AbortSignal;
}

export interface JsonResponse<T = any> {
  status: number;
  headers: Headers;
  body: T;
}

const CODES: Record<string, string> = {
  ECONNRESET: 'the connection was reset', ECONNREFUSED: 'the connection was refused', ENOTFOUND: 'the host was not found',
  EAI_AGAIN: 'DNS lookup failed', ETIMEDOUT: 'the connection timed out', UND_ERR_CONNECT_TIMEOUT: 'the connection timed out',
  UND_ERR_SOCKET: 'the connection dropped', CERT_HAS_EXPIRED: 'its TLS certificate has expired',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'its TLS certificate could not be verified', EHOSTUNREACH: 'the host is unreachable',
};

function classifyTransport(err: unknown, host: string): TransportError {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string; cause?: { code?: string } } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return new TransportError(`could not reach ${host}: no answer in time`, 'TimeoutError');
  }
  const code = e?.cause?.code || e?.cause?.cause?.code || '';
  const why = CODES[code] || (code ? `network error ${code}` : e?.cause?.message || e?.message || 'network error');
  return new TransportError(`could not reach ${host}: ${why}`, 'ConnectionError');
}

/**
 * fetch + JSON decode with a hard timeout. Throws Rejected for HTTP >= 400, TransportError when no
 * response arrived, BadResponse when the body is not JSON.
 */
export async function fetchJson<T = any>(url: string, opts: FetchJsonOptions): Promise<JsonResponse<T>> {
  configureOutboundProxy();
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: opts.headers,
      body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
      signal,
      redirect: 'follow',
    });
  } catch (err) {
    throw classifyTransport(err, new URL(url).host);
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw classifyTransport(err, new URL(url).host);
  }
  if (res.status >= 400) {
    let detail = '';
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || j?.ReturnMessage || j?.Message || '';
    } catch {
      /* not JSON */
    }
    throw new Rejected(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  let body: T;
  try {
    body = (text ? JSON.parse(text) : null) as T;
  } catch {
    throw new BadResponse(`expected JSON from ${new URL(url).pathname}, got ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
  }
  return { status: res.status, headers: res.headers, body };
}

/** Retry an idempotent operation on transport failures only: 3 attempts, 3s then 6s back-off. */
export async function withTransportRetry<T>(op: () => Promise<T>, attempts = 3, baseDelayMs = 3000,
  signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (!(err instanceof TransportError) || attempt >= attempts - 1 || signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
}
