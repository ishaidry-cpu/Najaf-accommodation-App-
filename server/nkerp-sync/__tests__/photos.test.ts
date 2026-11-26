import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.NAJAF_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'najaf-photo-test-'));
process.env.NAJAF_AUTO_PULL = 'false';
const { localStore, setup, write } = await import('../../local-store.js');
const { withStore } = await import('../../accommodation-store.js');
const { harvestPhotos, normalizePhoto, photoIndex, photoStore, prunePhotos } = await import('../../nkerp-photos.js');
const { NkerpClient } = await import('../../nkerp-sync/nkerpClient.js');
const { accommodationApi } = await import('../../accommodation-api.js');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]).toString('base64');
const photo = `data:image/jpeg;base64,${jpeg}`;

test('accepts NKERP data URIs, plain links and bare base64, and rejects anything else', () => {
  assert.equal(normalizePhoto(photo), photo);
  assert.equal(normalizePhoto('https://example.test/p.jpg'), 'https://example.test/p.jpg');
  assert.equal(normalizePhoto('iVBOR' + 'A'.repeat(300)), `data:image/png;base64,iVBOR${'A'.repeat(300)}`);
  for (const bad of ['', null, 'null', 'photo.jpg', 'javascript:alert(1)', 'data:text/html;base64,PGI+']) {
    assert.equal(normalizePhoto(bad), '');
  }
});

test('the pull collects photos by ITS (nested rows too) and strips them from the rows it plans with', async () => {
  const seen = new Map<string, string>();
  const client = new NkerpClient({ onPhoto: (its, image) => seen.set(its, image) });
  client.read = async () => ({ TotalRows: 2, lst: [
    { ITSId: 111, ImageUrl: photo, Name: 'A' },
    { Id: 7, ImageUrl: photo, RoomAllocatedDates_Current: [{ AppicantITSId: "'222", ImageUrl: photo }] },
  ] });
  const rows = await client.paged('x', {}, 'lst', (r) => String(r.ITSId ?? r.Id));
  assert.deepEqual([...seen.keys()], ['111', '222']);
  assert.ok(!JSON.stringify(rows).includes('ImageUrl'));

  // The allocation engine's own client (and any writing client) keeps its rows exactly as before.
  const writer = new NkerpClient({ allowWrite: true, onPhoto: () => assert.fail('a writing client never collects photos') });
  writer.read = async () => ({ TotalRows: 1, lst: [{ Id: 1, ImageUrl: photo, RoomAllocatedDates_Current: [{ AppicantITSId: 3, ImageUrl: photo }] }] });
  const kept = await writer.paged('x', {}, 'lst', (r) => String(r.Id));
  assert.equal(kept[0].ImageUrl, undefined);
  assert.equal(kept[0].RoomAllocatedDates_Current[0].ImageUrl, photo);

  const nested = { ITSId: 5, ImageUrl: 'not an image' };
  harvestPhotos(nested, () => assert.fail('only images are kept'));
  assert.equal('ImageUrl' in nested, false);
});

test('stores each photo once, serves it by ITS, and drops photos of zaereen who have left', () => withStore(localStore, async () => {
  setup();
  const first = photoStore();
  first.sink('111', photo);
  first.sink('111', 'data:image/png;base64,iVBORw0KGgo=');   // first photo of a pull wins
  first.sink('222', 'https://example.test/p.jpg');
  assert.equal(first.flush(), 2);
  const again = photoStore();
  again.sink('111', photo);
  assert.equal(again.flush(), 0);

  const api = accommodationApi();
  const index = await (await api.fetch(new Request('http://app/api/photos'))).json() as Record<string, string>;
  assert.deepEqual(Object.keys(index).sort(), ['111', '222']);
  const res = await api.fetch(new Request('http://app/api/photos/111'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(jpeg, 'base64'));
  const link = await api.fetch(new Request('http://app/api/photos/222'));
  assert.equal(link.status, 302);
  assert.equal((await api.fetch(new Request('http://app/api/photos/999'))).status, 404);

  assert.equal(prunePhotos(['111']), 1);
  assert.deepEqual(Object.keys(photoIndex()), ['111']);
  assert.equal((await api.fetch(new Request('http://app/api/photos/222'))).status, 404);
}));
