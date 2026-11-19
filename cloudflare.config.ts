/**
 * Cloudflare Workers hosting for the app: the Vite build as static assets, plus worker/index.ts for /api/*.
 * Deploy with `npm run deploy` (cf deploy). Secrets are set on the Worker, never here: see README.
 */
import { defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'najaf-accommodation',
    entrypoint: './worker/index.ts',
    compatibilityDate: '2026-11-17',
    // The sync engine uses Node's crypto, Buffer and process.env.
    compatibilityFlags: ['nodejs_compat'],
    assets: {
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/api/*'],
    },
    // A full sync reads every tour from NKERP; it mostly waits on the network, but give it CPU headroom.
    limits: { cpuMs: 300_000 },
    observability: { enabled: true },
  },
});
