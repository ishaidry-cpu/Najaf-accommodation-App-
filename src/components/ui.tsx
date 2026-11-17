import React, { useEffect, useRef, useState } from 'react';

/* Shared building blocks so every screen speaks the same visual language. */

export const btn = {
  primary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-medium bg-brand-700 hover:bg-brand-800 text-white shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium bg-white text-stone-800 ring-1 ring-inset ring-stone-200 hover:ring-stone-300 hover:bg-stone-50 shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
  ghost:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 transition cursor-pointer disabled:opacity-50 whitespace-nowrap',
};

export const PageHeader: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}> = ({ title, description, actions, meta }) => (
  <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between pt-1 md:pt-3 pb-1">
    <div className="min-w-0">
      <h1 className="text-[22px] md:text-[26px] leading-tight font-semibold tracking-[-0.02em] text-stone-950">{title}</h1>
      {description && <p className="mt-1 text-sm text-stone-500 max-w-2xl">{description}</p>}
      {meta && <div className="mt-2">{meta}</div>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

/* ------------------------------------------------------------------ */
/* Small dropdown menu: click to open, closes on outside click / Esc.  */
/* ------------------------------------------------------------------ */
export const Dropdown: React.FC<{
  trigger: (open: boolean) => React.ReactNode;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  children: (close: () => void) => React.ReactNode;
}> = ({ trigger, label, align = 'right', width = 'w-64', children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer"
      >
        {trigger(open)}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-[calc(100%+8px)] ${align === 'right' ? 'right-0' : 'left-0'} ${width} z-50 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100 origin-top`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

export const MenuItem: React.FC<{
  icon: React.ElementType;
  onClick: () => void;
  children: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}> = ({ icon: Icon, onClick, children, hint, tone = 'default', disabled }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    className={`w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition cursor-pointer disabled:opacity-50 disabled:cursor-default ${
      tone === 'danger' ? 'text-rose-700 hover:bg-rose-50' : 'text-stone-800 hover:bg-stone-100'
    }`}
  >
    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone === 'danger' ? 'text-rose-600' : 'text-stone-500'}`} />
    <span className="min-w-0">
      <span className="block font-medium leading-snug">{children}</span>
      {hint && <span className="block text-xs text-stone-500 leading-snug mt-0.5">{hint}</span>}
    </span>
  </button>
);

export const MenuDivider = () => <div className="my-1.5 h-px bg-stone-100" />;
export const MenuHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-stone-500">{children}</div>
);

