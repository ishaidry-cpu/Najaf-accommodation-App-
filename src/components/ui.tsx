import React, { useEffect, useRef, useState } from 'react';

/* Shared building blocks so every screen speaks the same visual language. */

/** A number that counts up to its value once, when it first appears (skipped for reduced motion). */
export const CountUp: React.FC<{ value: number; duration?: number; className?: string }> = ({ value, duration = 700, className }) => {
  const [shown, setShown] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) {
      setShown(value);
      return;
    }
    first.current = false;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || value <= 0) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    setShown(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={className}>{shown}</span>;
};

export const btn = {
  primary:
    'inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg text-sm font-semibold bg-brand-700 hover:bg-brand-600 active:bg-brand-800 text-white shadow-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-lg text-sm font-medium bg-white text-stone-800 ring-1 ring-inset ring-stone-300 hover:ring-stone-400 hover:bg-stone-50 shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
  ghost:
    'inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg text-sm font-medium text-stone-600 hover:text-stone-950 hover:bg-stone-200/70 transition cursor-pointer disabled:opacity-50 whitespace-nowrap',
};

/** Compact buttons for dense rows (tables, cards, toolbars). Same three kinds as `btn`, 32px tall. */
export const btnSm = {
  primary:
    'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold bg-brand-700 hover:bg-brand-600 active:bg-brand-800 text-white shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-medium bg-white text-stone-800 ring-1 ring-inset ring-stone-300 hover:ring-stone-400 hover:bg-stone-50 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
  ghost:
    'inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-medium text-stone-600 hover:text-stone-950 hover:bg-stone-200/70 transition cursor-pointer disabled:opacity-50 whitespace-nowrap',
  danger:
    'inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-medium text-rose-700 hover:bg-rose-50 transition cursor-pointer disabled:opacity-50 whitespace-nowrap',
};

/** Destructive confirm button (delete, remove, reset). */
export const btnDanger =
  'inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

/**
 * Status chips. One shape everywhere; the tone carries the meaning:
 * ok = allotted / vacant / done, wait = departing / pending / needs a look, bad = problem,
 * info = arriving / informational, special = same-day turnover / special handling, gold = starred.
 */
export type ChipTone = 'neutral' | 'ok' | 'wait' | 'bad' | 'info' | 'special' | 'gold' | 'brand';
const chipTones: Record<ChipTone, string> = {
  neutral: 'bg-stone-100 text-stone-700 ring-stone-200',
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  wait: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-blue-50 text-blue-700 ring-blue-200',
  special: 'bg-purple-50 text-purple-700 ring-purple-200',
  gold: 'bg-gold-50 text-gold-700 ring-gold-200',
  brand: 'bg-brand-700 text-white ring-brand-700',
};
export const chip = (tone: ChipTone = 'neutral') =>
  `inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap ${chipTones[tone]}`;

/** Surfaces. `card` sits on the sandstone; `panel` is a quiet inset inside a card (never a second card). */
export const card = 'rounded-2xl border border-stone-200 bg-white shadow-xs';
export const panel = 'rounded-xl bg-stone-50 ring-1 ring-inset ring-stone-200/70';

/** Form controls: one height, one border, one focus ring (the ring itself comes from index.css). */
export const field =
  'h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 disabled:bg-stone-100 disabled:text-stone-500';
export const fieldSm =
  'h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-[13px] text-stone-900 placeholder:text-stone-400 disabled:bg-stone-100 disabled:text-stone-500';
export const fieldLabel = 'block mb-1.5 text-[13px] font-medium text-stone-700';

/** A titled block inside a page: title, optional line of help, optional actions on the right. */
export const SectionHeader: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, description, actions, className = '' }) => (
  <div className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
    <div className="min-w-0">
      <h2 className="text-lg font-semibold leading-tight text-stone-950">{title}</h2>
      {description && <p className="mt-1 text-sm text-stone-600 max-w-[68ch]">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

/** Pop-up window chrome shared by every dialog: scrim, card, title bar with a close button. */
export const modalScrim = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/50 p-0 sm:p-4 animate-in fade-in duration-150';
export const modalCard = 'w-full bg-white shadow-2xl rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92dvh] animate-in zoom-in-95 duration-200';
export const modalHeader = 'flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b border-stone-200';
export const modalTitle = 'text-lg font-semibold leading-tight text-stone-950';
export const modalFooter = 'flex flex-wrap items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t border-stone-200 bg-stone-50 rounded-b-2xl';
export const modalClose = 'w-9 h-9 -mr-1.5 shrink-0 rounded-lg flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 cursor-pointer';

export const PageHeader: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}> = ({ title, description, actions, meta }) => (
  <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between pb-2">
    <div className="min-w-0">
      <h1 className="type-display text-[28px] md:text-[34px] leading-[1.05] font-semibold text-stone-950">{title}</h1>
      {description && <p className="mt-2.5 text-[15px] leading-relaxed text-stone-600 max-w-[68ch]">{description}</p>}
      {meta && <div className="mt-2.5">{meta}</div>}
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
  /** 'side' opens to the right of the trigger, growing upward: for menus at the foot of the rail. */
  placement?: 'below' | 'side';
  /** Stretch the trigger across its container. */
  block?: boolean;
  children: (close: () => void) => React.ReactNode;
}> = ({ trigger, label, align = 'right', width = 'w-64', placement = 'below', block = false, children }) => {
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
        className={`cursor-pointer rounded-lg ${block ? 'block w-full text-left' : ''}`}
      >
        {trigger(open)}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute ${
            placement === 'side'
              ? 'left-[calc(100%+12px)] bottom-0 origin-bottom-left'
              : `top-[calc(100%+8px)] origin-top ${align === 'right' ? 'right-0' : 'left-0'}`
          } ${width} z-50 rounded-xl border border-stone-200 bg-white p-1.5 text-stone-800 shadow-xl animate-in fade-in zoom-in-95 duration-100`}
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
  <div className="px-2.5 pt-2 pb-1 text-xs font-semibold text-stone-500">{children}</div>
);

