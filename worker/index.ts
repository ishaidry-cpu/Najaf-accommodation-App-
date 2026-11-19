/**
 * Cloudflare Worker for the app (replaces the Vercel Functions in api/nkerp-sync/).
 *
 * Static files (the Vite build) are served by Workers static assets; only /api/* reaches this code
 * (assets.runWorkerFirst in cloudflare.config.ts):
 *   /api/nkerp-sync/<name>  -> the same web-standard handlers Vercel and the Express server use
 *   any other /api/*        -> 404 JSON, as on Vercel (the app's data API exists only on its own server)
 *
 * Secrets (NKERP_LOGIN_ID, NKERP_PASSWORD, GOOGLE_SERVICE_ACCOUNT_JSON, NKERP_SYNC_ACCESS_KEY, GEMINI_API_KEY ...)
 * arrive on `env`; the engine reads process.env, so string values are copied there (nodejs_compat).
 */
import { dispatch } from '../server/nkerp-sync/handlers';

interface Ctx {
  waitUntil(work: Promise<unknown>): void;
}

function exposeEnv(env: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && process.env[k] !== v) process.env[k] = v;
  }
}

const notFound = () => new Response(JSON.stringify({ error: 'Not found' }), {
  status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: Ctx): Promise<Response> {
    exposeEnv(env);
    const { pathname } = new URL(request.url);
    const m = pathname.match(/^\/api\/nkerp-sync\/([a-z-]+)\/?$/);
    if (m) {
      try {
        return await dispatch(m[1], request, { waitUntil: (work) => ctx.waitUntil(work) });
      } catch (err) {
        console.error('[nkerp-sync] handler failed', err);
        return new Response(JSON.stringify({ error: (err as Error).message || 'Server error' }), {
          status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    }
    if (pathname.startsWith('/api/')) return notFound();
    const assets = env.ASSETS as { fetch(r: Request): Promise<Response> } | undefined;
    return assets ? assets.fetch(request) : notFound();
  },
};
