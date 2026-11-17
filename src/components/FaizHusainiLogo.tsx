import React, { useState } from 'react';

interface FaizHusainiLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSubtitle?: boolean;
  light?: boolean;
}

/**
 * Brand lockup: the seal, the Latin wordmark and the Arabic name in shrine gold.
 * `light` renders for dark (emerald) backgrounds.
 */
export const FaizHusainiLogo: React.FC<FaizHusainiLogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
  light = false,
}) => {
  const [imgError, setImgError] = useState(false);

  const sizeMap = {
    sm: { icon: 'w-8 h-8', text: 'text-[15px]', ar: 'text-[15px]', sub: 'text-[11px]' },
    md: { icon: 'w-10 h-10', text: 'text-base', ar: 'text-base', sub: 'text-xs' },
    lg: { icon: 'w-12 h-12', text: 'text-lg', ar: 'text-lg', sub: 'text-xs' },
    xl: { icon: 'w-16 h-16', text: 'text-xl', ar: 'text-xl', sub: 'text-sm' },
  };
  const s = sizeMap[size];

  return (
    <div className={`flex items-center gap-2.5 select-none min-w-0 ${className}`}>
      <div className={`${s.icon} shrink-0 rounded-full p-[2px] bg-gradient-to-b from-gold-200 to-gold-600`}>
        {!imgError ? (
          <img
            src="/faize-logo.png"
            alt=""
            className="w-full h-full object-cover rounded-full bg-brand-800"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full rounded-full bg-brand-700 flex items-center justify-center text-gold-200 font-semibold text-xs">
            FH
          </div>
        )}
      </div>

      <div className="flex flex-col min-w-0 leading-none">
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className={`${s.text} font-semibold tracking-[-0.01em] truncate ${light ? 'text-white' : 'text-stone-950'}`}
            style={{ fontStretch: '92%' }}
          >
            Faiz-e-Husaini
          </span>
          <span
            lang="ar"
            dir="rtl"
            className={`${s.ar} font-arabic font-bold shrink-0 ${light ? 'text-gold-200' : 'text-gold-600'}`}
          >
            فيض حسيني
          </span>
        </div>
        {showSubtitle && (
          <span className={`${s.sub} mt-1 truncate ${light ? 'text-brand-100' : 'text-stone-500'}`}>
            Zaereen accommodation, Najaf
          </span>
        )}
      </div>
    </div>
  );
};
