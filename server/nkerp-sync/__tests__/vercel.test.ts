/**
 * The Vercel deployment as it will actually run: the plain JavaScript functions in api/nkerp-sync/ loading
 * the pre-built engine (api/_lib/nkerp-sync.mjs) in a plain Node process, with no TypeScript tooling.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Vercel functions', () => {
  it('the committed engine bundle is up to date with server/nkerp-sync (else run npm run build:api)', async () => {
    const { options } = await import(path.join(root, 'scripts/build-api.mjs'));
    const out = await build({ ...options, write: false, outfile: path.join(root, 'api/_lib/nkerp-sync.mjs') });
    const fresh = out.outputFiles![0].text;
    const committed = fs.readFileSync(path.join(root, 'api/_lib/nkerp-sync.mjs'), 'utf8');
    assert.ok(fresh === committed, 'api/_lib/nkerp-sync.mjs is stale: run `npm run build:api` and commit it');
  });

  it('every function loads as plain ESM and answers without credentials or network', () => {
    const probe = `
      const out = {};
      const cfg = await import('./api/nkerp-sync/config.js');
      const c = cfg.GET(); out.config = [c.status, (await c.json()).configured];
      const run = await import('./api/nkerp-sync/run.js');
      out.runMax = run.config.maxDuration;
      const bad = await run.POST(new Request('http://x/api/nkerp-sync/run', { method: 'POST', body: '{"today":"bad"}' }));
      out.runBad = [bad.status, (await bad.json()).error];
      const un = await run.POST(new Request('http://x/api/nkerp-sync/run', { method: 'POST', body: '{}' }));
      out.runUnconfigured = un.status;
      const hist = await import('./api/nkerp-sync/history.js');
      const h = await hist.GET(new Request('http://x/api/nkerp-sync/history'));
      out.history = [h.status, (await h.json()).runs.length];
      const it = await import('./api/nkerp-sync/interpret.js');
      const p = await it.POST(new Request('http://x/api/nkerp-sync/interpret', { method: 'POST', body: '{"text":"preview tomorrow"}' }));
      out.interpret = [(await p.json()).intent];
      const auth = await import('./api/nkerp-sync/auth.js');
      out.auth = auth.POST(new Request('http://x/api/nkerp-sync/auth', { method: 'POST' })).status;
      console.log(JSON.stringify(out));
    `;
    const env: NodeJS.ProcessEnv = { ...process.env, VERCEL: '1' };
    for (const k of ['NKERP_LOGIN_ID', 'NKERP_PASSWORD', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_FILE',
      'NKERP_SYNC_ACCESS_KEY', 'GEMINI_API_KEY', 'NODE_OPTIONS']) delete env[k];
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), {
      config: [200, false], runMax: 300, runBad: [400, 'today must be a YYYY-MM-DD date'], runUnconfigured: 503,
      history: [200, 0], interpret: ['preview'], auth: 200,
    });
  });

  it('function files are plain JavaScript (Vercel never compiles the engine TypeScript)', () => {
    const files = fs.readdirSync(path.join(root, 'api/nkerp-sync'));
    assert.deepEqual(files.filter((f) => !f.endsWith('.js')), []);
    for (const f of files) {
      assert.match(fs.readFileSync(path.join(root, 'api/nkerp-sync', f), 'utf8'), /from '\.\.\/_lib\/nkerp-sync\.mjs'/);
    }
  });
});
