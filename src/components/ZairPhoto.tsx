import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** ITS → photo version, from /api/photos. Only zaereen with an NKERP photo are listed. */
export type PhotoIndex = Record<string, string>;

const photoIts = (itsId: unknown) => String(itsId ?? '').replace(/^['’]/, '').trim();

export const photoUrl = (photos: PhotoIndex | undefined, itsId: unknown) => {
  const its = photoIts(itsId);
  const version = its ? photos?.[its] : undefined;
  return version ? `/api/photos/${encodeURIComponent(its)}?v=${version}` : '';
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';

interface ZairPhotoProps {
  photos?: PhotoIndex;
  itsId: unknown;
  name: string;
  size?: number;
}

/** A zair's NKERP photo as a small avatar. Click it to see the photo full size. */
export const ZairPhoto: React.FC<ZairPhotoProps> = ({ photos, itsId, name, size = 28 }) => {
  const src = photoUrl(photos, itsId);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setFailed(false), [src]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  const box = { width: size, height: size };
  if (!src || failed) {
    return (
      <span
        style={box}
        className="shrink-0 inline-flex items-center justify-center rounded-full bg-stone-100 border border-stone-200 text-stone-400 font-bold select-none"
        title={`No NKERP photo for ITS ${photoIts(itsId)}`}
      >
        <span style={{ fontSize: Math.max(9, Math.round(size * 0.36)) }}>{initials(name)}</span>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={box}
        className="shrink-0 rounded-full overflow-hidden border border-stone-300 bg-stone-100 cursor-zoom-in hover:ring-2 hover:ring-[#c9a85a] transition"
        title={`View photo of ${name} (ITS ${photoIts(itsId)})`}
      >
        <img
          src={src}
          alt={`Photo of ${name}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover object-top"
        />
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[200] bg-stone-950/75 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Photo of ${name}`}
        >
          <figure
            className="relative bg-white rounded-2xl shadow-2xl p-3 max-w-[min(92vw,420px)]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute -top-3 -right-3 w-11 h-11 flex items-center justify-center rounded-full bg-white border border-stone-200 shadow text-stone-700 hover:text-stone-950 cursor-pointer"
              aria-label="Close photo"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={src}
              alt={`Photo of ${name}`}
              className="block w-full max-h-[75vh] object-contain rounded-xl bg-stone-50"
            />
            <figcaption className="mt-2 text-center">
              <div className="text-sm font-extrabold text-stone-900">{name}</div>
              <div className="text-xs font-mono text-stone-500 tabular-nums">ITS {photoIts(itsId)}</div>
            </figcaption>
          </figure>
        </div>,
        document.body,
      )}
    </>
  );
};
