import { createHash } from 'node:crypto';
import { read, remove, write } from './accommodation-store.js';
import type { NkRecord } from './nkerp-sync/types.js';

/**
 * Zair photos from NKERP. NKERP sends each applicant's photo as `ImageUrl` (normally a base64 JPEG data URI,
 * the value its own screens put straight into an <img>). Photos are kept apart from the reservations list, one
 * stored value per ITS plus a small ITS → version index, so the list and every pull stay small.
 */
export type PhotoSink = (its: string, image: string) => void;

const ITS_FIELDS = ['ITSId', 'AppicantITSId', 'ApplicantITSId', 'ITSID', 'ItsId', 'ITSNo'] as const;
const MAX_PHOTO_LENGTH = 1_500_000;
const INDEX = 'photo-index';
const photoKey = (its: string) => `photo:${its}`;

export const photoIts = (value: unknown) => String(value ?? '').replace(/^['’]/, '').trim();

/** An image NKERP sent, as something an <img> can show, or '' when it is not one. */
export function normalizePhoto(value: unknown): string {
  const image = String(value ?? '').trim();
  if (!image || image.length > MAX_PHOTO_LENGTH) return '';
  if (/^data:image\/(jpeg|jpg|png|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(image)) return image.replace(/\s+/g, '');
  if (/^https?:\/\/\S+$/i.test(image)) return image;
  const raw = image.replace(/\s+/g, '');
  if (raw.length >= 200 && /^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    const type = raw.startsWith('iVBOR') ? 'png' : raw.startsWith('R0lGOD') ? 'gif' : raw.startsWith('UklGR') ? 'webp' : 'jpeg';
    return `data:image/${type};base64,${raw}`;
  }
  return '';
}

/**
 * Takes every `ImageUrl` out of an NKERP record (nested ones included), handing each photo that belongs to an
 * ITS to the sink. Removing them keeps the large strings out of the rows the sync plans with.
 */
export function harvestPhotos(record: unknown, sink?: PhotoSink, depth = 0): void {
  if (!record || typeof record !== 'object' || depth > 6) return;
  if (Array.isArray(record)) {
    for (const item of record) harvestPhotos(item, sink, depth + 1);
    return;
  }
  const row = record as NkRecord;
  if ('ImageUrl' in row) {
    if (sink) {
      const its = photoIts(ITS_FIELDS.map((field) => row[field]).find((v) => photoIts(v)));
      const image = normalizePhoto(row.ImageUrl);
      if (its && image) sink(its, image);
    }
    delete row.ImageUrl;
  }
  for (const value of Object.values(row)) if (value && typeof value === 'object') harvestPhotos(value, sink, depth + 1);
}

const version = (image: string) => createHash('sha256').update(image).digest('hex').slice(0, 16);
export const photoIndex = () => read<Record<string, string>>(INDEX, {});

/** A sink that saves a photo only when it is new or changed. The first photo seen for an ITS in a pull wins. */
export function photoStore() {
  const index = photoIndex();
  const seen = new Set<string>();
  let changed = 0;
  const sink: PhotoSink = (its, image) => {
    if (seen.has(its)) return;
    seen.add(its);
    const next = version(image);
    if (index[its] === next) return;
    write(photoKey(its), image);
    index[its] = next;
    changed++;
  };
  /** Saves the index once per pull, not once per photo. */
  const flush = () => { if (changed) write(INDEX, index); return changed; };
  return { sink, flush };
}

/** Drops photos of zaereen who no longer have any stay in the app. */
export function prunePhotos(keep: Iterable<unknown>): number {
  const index = photoIndex();
  const wanted = new Set([...keep].map(photoIts).filter(Boolean));
  const stale = Object.keys(index).filter((its) => !wanted.has(its));
  for (const its of stale) {
    remove(photoKey(its));
    delete index[its];
  }
  if (stale.length) write(INDEX, index);
  return stale.length;
}

/** The stored photo of one zair as an HTTP response. */
export function photoResponse(its: string): Response {
  const id = photoIts(its);
  const tag = photoIndex()[id];
  const image = tag ? read<string>(photoKey(id), '') : '';
  if (!image) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (/^https?:/i.test(image)) return Response.redirect(image, 302);
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(image);
  if (!match) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(Buffer.from(match[2], 'base64'), {
    headers: {
      'Content-Type': match[1].toLowerCase().replace('image/jpg', 'image/jpeg'),
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: `"${tag}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
