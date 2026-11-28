import React, { useEffect, useState } from 'react';
import { User } from 'lucide-react';

/** ITS → photo version, from /api/photos. Only zaereen with an NKERP photo are listed. */
export type PhotoIndex = Record<string, string>;

const photoIts = (itsId: unknown) => String(itsId ?? '').replace(/^['’]/, '').trim();

export const photoUrl = (photos: PhotoIndex | undefined, itsId: unknown) => {
  const its = photoIts(itsId);
  const version = its ? photos?.[its] : undefined;
  return version ? `/api/photos/${encodeURIComponent(its)}?v=${version}` : '';
};

interface ZairPhotoProps {
  photos?: PhotoIndex;
  itsId: unknown;
  name: string;
  /** Square size in px. 96 matches NKERP's room allocation list. */
  size?: number;
}

/** Without a photo the row should stay compact: a small quiet avatar, never a photo-sized empty box. */
const PLACEHOLDER_SIZE = 40;

/** A zair's NKERP photo, shown at NKERP's list size so it can be recognised without opening anything. */
export const ZairPhoto: React.FC<ZairPhotoProps> = ({ photos, itsId, name, size = 96 }) => {
  const src = photoUrl(photos, itsId);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    const small = Math.min(size, PLACEHOLDER_SIZE);
    return (
      <div
        role="img"
        aria-label="No photo"
        style={{ width: small, height: small }}
        className="shrink-0 flex items-center justify-center rounded-full bg-stone-100 text-stone-400"
        title={`No NKERP photo for ITS ${photoIts(itsId)}`}
      >
        <User className="w-5 h-5" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div style={{ width: size, height: size }} className="shrink-0 border border-stone-300 bg-stone-100 overflow-hidden">
      <img
        src={src}
        alt={`Photo of ${name}`}
        title={`${name} · ITS ${photoIts(itsId)}`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="w-full h-full object-cover"
      />
    </div>
  );
};
