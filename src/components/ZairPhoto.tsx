import React, { useEffect, useState } from 'react';

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

/** A zair's NKERP photo, shown at NKERP's list size so it can be recognised without opening anything. */
export const ZairPhoto: React.FC<ZairPhotoProps> = ({ photos, itsId, name, size = 96 }) => {
  const src = photoUrl(photos, itsId);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const box = { width: size, height: size };

  if (!src || failed) {
    return (
      <div
        style={box}
        className="shrink-0 flex items-center justify-center border border-dashed border-stone-300 bg-stone-50 text-stone-400 text-[10px] font-semibold text-center leading-tight"
        title={`No NKERP photo for ITS ${photoIts(itsId)}`}
      >
        No photo
      </div>
    );
  }

  return (
    <div style={box} className="shrink-0 border border-[#ccc] bg-stone-100 overflow-hidden">
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
