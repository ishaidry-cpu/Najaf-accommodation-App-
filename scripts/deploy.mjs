#!/usr/bin/env node
/**
 * Runs `cf deploy` (or `cf deploy --dry-run`) so it works both on a normal computer and in a Claude Code
 * cloud session.
 *
 * In a cloud session all HTTPS goes through an agent proxy (HTTPS_PROXY) that adds the Cloudflare API key to
 * requests for api.cloudflare.com. curl uses that proxy, but Node's built-in HTTP client ignores HTTPS_PROXY
 * unless NODE_USE_ENV_PROXY=1 is set. Without it the cf CLI connected to Cloudflare directly, sent its
 * placeholder token, and the deploy failed with "[9106] Authentication failed". This script turns the proxy
 * on for the cf CLI and gives it a placeholder token for the proxy to replace.
 *
 * On a computer without HTTPS_PROXY nothing changes: cf uses your login or CLOUDFLARE_API_TOKEN as usual.
 */
import { spawnSync } from 'node:child_process';

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const env = { ...process.env };

if (proxy) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const supported = (major === 22 && minor >= 21) || (major === 24 && minor >= 5) || major >= 25;
  if (!supported) {
    console.error(`Node ${process.versions.node} cannot send its requests through HTTPS_PROXY. Use Node 22.21+ or 24.5+.`);
    process.exit(1);
  }
  env.NODE_USE_ENV_PROXY = '1';
  // The proxy swaps this for the real key. A real token, if one is set, is left alone.
  if (!env.CLOUDFLARE_API_TOKEN) env.CLOUDFLARE_API_TOKEN = 'injected-by-agent-proxy';
  console.log('HTTPS proxy detected: sending Cloudflare requests through it.');
}

const args = ['cf', 'deploy', ...process.argv.slice(2)];
const result = spawnSync('npx', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
