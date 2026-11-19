import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type PluginOption} from 'vite';

/*
 * The Cloudflare plugin is on only when the `cf` CLI runs Vite (cf build / cf deploy set these variables) or
 * CLOUDFLARE=1 is set. A plain `vite build` and the app's own Express server (server.ts) stay exactly as before.
 */
const onCloudflare = ['CLOUDFLARE', 'CLOUDFLARE_VITE_FORCE_BUILD_OUTPUT', 'CLOUDFLARE_VITE_BUILD', 'CF_DELEGATION']
  .some((k) => Boolean(process.env[k]));

async function cloudflarePlugins(): Promise<PluginOption[]> {
  if (!onCloudflare) return [];
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return [cloudflare()];
}

export default defineConfig(async () => {
  return {
    plugins: [react(), tailwindcss(), ...(await cloudflarePlugins())],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
