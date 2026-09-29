import React, { useState } from 'react';

interface FaizHusainiLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSubtitle?: boolean;
  light?: boolean;
}

export const FaizHusainiLogo: React.FC<FaizHusainiLogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
  light = false,
}) => {
  const [imgError, setImgError] = useState(false);

  const sizeMap = {
    sm: { icon: 'w-8 h-8', text: 'text-sm', sub: 'text-[9px]' },
    md: { icon: 'w-10 h-10', text: 'text-base', sub: 'text-[10px]' },
    lg: { icon: 'w-12 h-12', text: 'text-lg', sub: 'text-xs' },
    xl: { icon: 'w-16 h-16', text: 'text-xl', sub: 'text-xs' },
  };

  const currentSize = sizeMap[size];

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Official FAIze / Faiz Husaini Logo Badge */}
      <div
        className={`${currentSize.icon} rounded-full p-0.5 flex items-center justify-center shadow-md bg-gradient-to-br from-[#124E39] via-[#0E3C2C] to-[#07241A] border-2 border-[#C5A059] relative overflow-hidden flex-shrink-0`}
      >
        {!imgError ? (
          <img
            src="/faize-logo.png"
            alt="Faiz-e-Husaini Logo"
            className="w-full h-full object-cover rounded-full"
            onError={() => {
              // Try fallback path if needed
              setImgError(true);
            }}
          />
        ) : (
          <div className="w-full h-full rounded-full bg-[#124E39] flex items-center justify-center text-[#EBD59E] font-bold text-xs">
            FH
          </div>
        )}
      </div>

      {/* Typography */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span
            className={`font-serif tracking-wider font-extrabold leading-tight ${currentSize.text} ${
              light ? 'text-[#124E39]' : 'text-[#0E3829]'
            }`}
          >
            FAIZ-E-HUSAINI
          </span>
          <span className="text-[10px] font-arabic px-1.5 py-0.5 rounded-md bg-[#124E39]/10 text-[#124E39] border border-[#124E39]/20 font-bold">
            فيض حسيني
          </span>
        </div>
        {showSubtitle && (
          <span className={`${currentSize.sub} text-stone-600 font-semibold tracking-tight`}>
            Zaereen Lodging & Accommodation Operations
          </span>
        )}
      </div>
    </div>
  );
};

