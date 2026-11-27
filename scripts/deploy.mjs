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
 * The proxy also replaces the short-lived token Cloudflare's static-asset file upload needs, so through the proxy
 * any deploy with a changed page file failed with "401 Unauthorized" on workers/assets/upload. In a cloud session
 * this script therefore builds first, packs the page files into the Worker bundle (scripts/embed-assets.mjs),
 * and deploys that prebuilt output, which needs only the API key.
 *
 * On a computer without HTTPS_PROXY nothing changes: cf builds and deploys with static assets as usual, using
 * your login or CLOUDFLARE_API_TOKEN.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedAssets } from './embed-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Never deploy an old copy over newer code. Several people and Claude sessions deploy this Worker; on
 * 27 Nov 2026 a checkout that was behind main deployed a minute after main did and put older code live. So the
 * deploy first fetches origin/main and stops unless this checkout already contains it.
 * Override (rarely right) with --allow-behind-main.
 */
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const args = process.argv.slice(2).filter((a) => a !== '--allow-behind-main');
if (!process.argv.includes('--allow-behind-main') && !args.includes('--dry-run') && git('rev-parse', '--git-dir').status === 0) {
  const fetched = git('fetch', '--quiet', 'origin', 'main');
  if (fetched.status !== 0) {
    console.error('Could not fetch origin/main to check this checkout is up to date; not deploying.\n' + (fetched.stderr || '').trim());
    process.exit(1);
  }
  if (git('merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD').status !== 0) {
    console.error('This checkout is behind origin/main, so deploying it would replace newer live code. Pull or merge main first.');
    process.exit(1);
  }
}
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const env = { ...process.env };
const run = (args) => spawnSync('npx', ['cf', ...args], { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' }).status ?? 1;

if (!proxy) process.exit(run(['deploy', ...args]));

const [major, minor] = process.versions.node.split('.').map(Number);
const supported = (major === 22 && minor >= 21) || (major === 24 && minor >= 5) || major >= 25;
if (!supported) {
  console.error(`Node ${process.versions.node} cannot send its requests through HTTPS_PROXY. Use Node 22.21+ or 24.5+.`);
  process.exit(1);
}
env.NODE_USE_ENV_PROXY = '1';
// The proxy swaps this for the real key. A real token, if one is set, is left alone.
if (!env.CLOUDFLARE_API_TOKEN) env.CLOUDFLARE_API_TOKEN = 'injected-by-agent-proxy';
console.log('HTTPS proxy detected: sending Cloudflare requests through it, with the page files inside the Worker.');

const built = run(['build']);
if (built !== 0) process.exit(built);
const workers = path.join(root, '.cloudflare', 'output', 'v1', 'workers');
for (const name of readdirSync(workers)) {
  const result = embedAssets(path.join(workers, name));
  console.log(`Packed ${result.embedded ?? 0} page files (${Math.round((result.bytes ?? 0) / 1024)} KB) into Worker "${name}"${result.skipped ? ` (${result.skipped})` : ''}.`);
}
process.exit(run(['deploy', '--prebuilt', ...args]));
