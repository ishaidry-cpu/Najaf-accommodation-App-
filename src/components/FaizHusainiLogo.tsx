import React, { useState } from 'react';

interface FaizHusainiLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSubtitle?: boolean;
  /** Renders for dark (emerald) backgrounds. */
  light?: boolean;
  /** The Arabic name sits under the Latin one instead of beside it (narrow columns such as the rail). */
  stacked?: boolean;
  /** Only the seal, for the collapsed rail. */
  sealOnly?: boolean;
}

/** The round crest with its gilded rim. */
export const FaizSeal: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => {
  const [imgError, setImgError] = useState(false);
  return (
    <div className={`${className} shrink-0 rounded-full p-[2px] bg-gold-400 shadow-[0_1px_2px_rgb(0_0_0/0.25)]`}>
      {!imgError ? (
        <span className="block w-full h-full overflow-hidden rounded-full bg-brand-800">
          <img
            src="/crest-192.jpg"
            alt=""
            width={96}
            height={96}
            decoding="async"
            className="w-full h-full object-cover scale-[1.07]"
            onError={() => setImgError(true)}
          />
        </span>
      ) : (
        <div className="w-full h-full rounded-full bg-brand-700 flex items-center justify-center text-gold-200 font-semibold text-xs">
          FH
        </div>
      )}
    </div>
  );
};

/**
 * Brand lockup: the seal, the Latin wordmark and the Arabic name in gold, both set in the Kufic display face.
 */
export const FaizHusainiLogo: React.FC<FaizHusainiLogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
  light = false,
  stacked = false,
  sealOnly = false,
}) => {
  const sizeMap = {
    sm: { icon: 'w-9 h-9', text: 'text-[16px]', ar: 'text-[15px]', sub: 'text-[11px]' },
    md: { icon: 'w-10 h-10', text: 'text-[17px]', ar: 'text-base', sub: 'text-xs' },
    lg: { icon: 'w-12 h-12', text: 'text-xl', ar: 'text-lg', sub: 'text-xs' },
    xl: { icon: 'w-16 h-16', text: 'text-2xl', ar: 'text-xl', sub: 'text-sm' },
  };
  const s = sizeMap[size];
  if (sealOnly) return <FaizSeal className={`${s.icon} ${className}`} />;

  const latin = (
    <span className={`${s.text} font-display font-semibold leading-none truncate ${light ? 'text-white' : 'text-stone-950'}`}>
      Faiz-e-Husaini
    </span>
  );
  const arabic = (
    <span lang="ar" dir="rtl" className={`${s.ar} font-arabic font-medium leading-none shrink-0 ${light ? 'text-gold-300' : 'text-gold-600'}`}>
      فيض حسيني
    </span>
  );

  return (
    <div className={`flex items-center gap-2.5 select-none min-w-0 ${className}`}>
      <FaizSeal className={s.icon} />
      <div className="flex flex-col min-w-0 leading-none">
        {stacked ? (
          <>
            {latin}
            <span className="mt-1.5 flex">{arabic}</span>
          </>
        ) : (
          <div className="flex items-baseline gap-2 min-w-0">
            {latin}
            {arabic}
          </div>
        )}
        {showSubtitle && (
          <span className={`${s.sub} mt-1.5 truncate ${light ? 'text-brand-200' : 'text-stone-500'}`}>
            Zaereen accommodation, Najaf
          </span>
        )}
      </div>
    </div>
  );
};
