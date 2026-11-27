/** The cloud-session deploy packs page files into the Worker; the packed Worker must serve them like static assets. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { embedAssets } from '../embed-assets.mjs';

test('serves packed files, the single-page app fallback and /api/* through the app Worker', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'embed-'));
  mkdirSync(path.join(dir, 'bundle'));
  mkdirSync(path.join(dir, 'assets', 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'assets', 'index.html'), '<!doctype html><title>App</title>');
  writeFileSync(path.join(dir, 'assets', 'assets', 'index-AbCdEf12.js'), 'console.log("é")');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
  writeFileSync(path.join(dir, 'assets', 'logo.png'), png);
  writeFileSync(path.join(dir, 'assets', 'copy.png'), png);
  writeFileSync(path.join(dir, 'assets', '.gitignore'), '*');
  writeFileSync(path.join(dir, 'bundle', 'index.js'),
    'export class Accommodation {}\nexport default { fetch: () => new Response("api"), scheduled: async () => "tick" };\n');
  writeFileSync(path.join(dir, 'worker.config.json'), JSON.stringify({ name: 'x',
    assets: { notFoundHandling: 'single-page-application', runWorkerFirst: ['/api/*'] }, manifest: { type: 'partial', mainModule: 'index.js', modules: {} } }));

  const result = embedAssets(dir);
  assert.equal(result.embedded, 4);
  const config = JSON.parse(readFileSync(path.join(dir, 'worker.config.json'), 'utf8'));
  assert.equal(config.assets, undefined);
  assert.equal(config.manifest.mainModule, 'static-entry.js');
  assert.equal(existsSync(path.join(dir, 'assets')), false, 'nothing left for the asset upload step');
  assert.equal(embedAssets(dir).skipped, 'no assets setting', 'a second pass changes nothing');

  const mod = await import(pathToFileURL(path.join(dir, 'bundle', 'static-entry.js')).href);
  assert.equal(typeof mod.Accommodation, 'function');
  const get = (p, headers = {}) => mod.default.fetch(new Request('https://x.test' + p, { headers }), {}, {});
  assert.equal(await (await get('/api/status')).text(), 'api');
  const home = await get('/');
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /<title>App/);
  assert.match(await (await get('/approvals')).text(), /<title>App/);
  const js = await get('/assets/index-AbCdEf12.js');
  assert.equal(await js.text(), 'console.log("é")');
  assert.match(js.headers.get('cache-control'), /immutable/);
  const img = await get('/copy.png');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await get('/missing.png')).status, 404);
  assert.equal((await get('/.gitignore')).status, 404);
  assert.equal((await get('/logo.png', { 'if-none-match': img.headers.get('etag') })).status, 304);
  assert.equal(await mod.default.scheduled(), 'tick');
});
