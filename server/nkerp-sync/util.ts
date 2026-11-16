/**
 * Small, pure helpers shared by every part of the Najaf -> NKERP sync engine.
 *
 * The engine is a faithful TypeScript port of the `najaf-accommodation-allocation` skill
 * (scripts/najaf_alloc.py + scripts/history.py). Several helpers here exist only so that the port
 * behaves *exactly* like the Python reference: Python's tuple ordering, its `strptime` date formats and
 * the `repr()` of lists that ends up in report text. The differential test in
 * `__tests__/parity.test.ts` runs both implementations on the same scenarios and diffs the output.
 */

/** Python's `re.sub(r'\s+', ' ', str(s or '')).strip().upper()`. */
export function norm(s: unknown): string {
  const text = s === null || s === undefined ? '' : String(s);
  return text.replace(/\s+/gu, ' ').trim().toUpperCase();
}

/** First 10 characters (the ISO date part of an NKERP timestamp). */
export function day(s: unknown): string {
  return String(s).slice(0, 10);
}

/** Python's `str.title()`: first letter of every alphabetic run upper-cased, the rest lower-cased. */
export function pyTitle(s: string): string {
  let out = '';
  let prevCased = false;
  for (const ch of s) {
    const isLetter = ch.toLowerCase() !== ch.toUpperCase();
    if (isLetter) {
      out += prevCased ? ch.toLowerCase() : ch.toUpperCase();
      prevCased = true;
    } else {
      out += ch;
      prevCased = false;
    }
  }
  return out;
}

/** 'SAIFEE', '107' -> 'Saifee 107'; both blank -> ''. */
export function place(building: string, room: string): string {
  return building || room ? `${pyTitle(building)} ${room}`.trim() : '';
}

/** 'F-7', 'F7', 'f - 07', '7' -> 'F-7'; anything else -> ''. */
export function familyNo(s: unknown): string {
  const m = /^F?\s*-?\s*0*(\d+)$/u.exec(norm(s));
  return m ? `F-${parseInt(m[1], 10)}` : '';
}

// ------------------------------------------------------------------------------------------------ dates

const MONTHS_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_FULL = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** The same directive regexes CPython's `_strptime` uses (C locale). */
const DIRECTIVES: Record<string, string> = {
  d: '(?<d>3[01]|[12]\\d|0[1-9]|[1-9]| [1-9])',
  m: '(?<m>1[0-2]|0[1-9]|[1-9])',
  Y: '(?<Y>\\d\\d\\d\\d)',
  b: `(?<b>${MONTHS_ABBR.join('|')})`,
  B: `(?<B>${MONTHS_FULL.join('|')})`,
};

/** Day-first formats, tried in order (the skill's DATE_FORMATS). */
export const DATE_FORMATS = [
  '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%d.%m.%Y', '%Y/%m/%d', '%d-%b-%Y', '%d %b %Y', '%d-%B-%Y',
  '%d %B %Y', '%b %d, %Y', '%B %d, %Y',
];

const compiled = new Map<string, RegExp>();

function formatRegex(fmt: string): RegExp {
  const hit = compiled.get(fmt);
  if (hit) return hit;
  let src = '';
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '%') {
      src += DIRECTIVES[fmt[++i]];
    } else if (/\s/u.test(ch)) {
      src += '\\s+';                     // strptime turns format whitespace into \s+
    } else {
      src += ch.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
    }
  }
  const re = new RegExp(`^${src}$`, 'iu');  // strptime is case-insensitive and must consume everything
  compiled.set(fmt, re);
  return re;
}

function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Python `datetime.strptime(s, fmt).date().isoformat()` for the formats above, or null. */
export function strptimeDate(s: string, fmt: string): string | null {
  const m = formatRegex(fmt).exec(s);
  if (!m || !m.groups) return null;
  const g = m.groups;
  const year = parseInt(g.Y, 10);
  let month: number;
  if (g.m !== undefined) month = parseInt(g.m, 10);
  else if (g.b !== undefined) month = MONTHS_ABBR.indexOf(g.b.toLowerCase()) + 1;
  else month = MONTHS_FULL.indexOf(g.B.toLowerCase()) + 1;
  const dayOfMonth = parseInt(g.d.trim(), 10);
  if (year < 1) return null;
  return isoDate(year, month, dayOfMonth);
}

/** Add whole days to an ISO date (UTC arithmetic, no time zone drift). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return dt.toISOString().slice(0, 10);
}

/**
 * ISO date from the Sheet's ARRIVAL cell, or null. A real date cell arrives as a serial number in `raw`
 * (days since 1899-12-30); a typed text date is parsed day-first (26-11-2026 is 26 Nov).
 */
export function parseArrival(formatted: unknown, raw?: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return addDays('1899-12-30', Math.trunc(raw));
  }
  let s = String(formatted ?? '').trim();
  if (!s) return null;
  s = s.split(/[T ]\d{1,2}:\d{2}/u)[0].trim();           // drop a time part
  for (const fmt of DATE_FORMATS) {
    const iso = strptimeDate(s, fmt);
    if (iso) return iso;
  }
  return null;
}

/** Today's date in a time zone (default Asia/Baghdad, NKERP's local time) as YYYY-MM-DD. */
export function todayIn(timeZone = 'Asia/Baghdad', now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Wall-clock parts in a time zone, for 'Run At' (YYYY-MM-DD HH:MM) and 'Run ID' (YYYYMMDD-HHMMSS). */
export function stampsIn(timeZone = 'Asia/Baghdad', now: Date = new Date()): { runAt: string; runId: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const [Y, M, D, h, m, s] = ['year', 'month', 'day', 'hour', 'minute', 'second'].map(get);
  return { runAt: `${Y}-${M}-${D} ${h}:${m}`, runId: `${Y}${M}${D}-${h}${m}${s}` };
}

// ------------------------------------------------------------------------------------------------ Python parity

export type PyKey = string | number | boolean | null | undefined | PyKey[];

/** Python's ordering for strings, numbers and tuples (lists) of them. */
export function pyCompare(a: PyKey, b: PyKey): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = pyCompare(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  // Python compares strings by code point; JS `<` compares UTF-16 code units. Same for the BMP.
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Stable sort by a Python-comparable key (Python's sort is stable too). */
export function sortBy<T>(items: Iterable<T>, key: (t: T) => PyKey): T[] {
  return [...items]
    .map((item, i) => ({ item, i, k: key(item) }))
    .sort((x, y) => pyCompare(x.k, y.k) || x.i - y.i)
    .map((x) => x.item);
}

/** `sorted(set_of_strings)`. */
export function sortedStrings(items: Iterable<string>): string[] {
  return sortBy(new Set(items), (s) => s);
}

/** Python `repr()` of strings, numbers, None, booleans and lists/tuples of them (for report text parity). */
export function pyRepr(v: unknown, tuple = false): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'string') {
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    const body = v.replace(/\\/gu, '\\\\').replace(/\n/gu, '\\n').replace(/\r/gu, '\\r').replace(/\t/gu, '\\t');
    return q + (q === "'" ? body.replace(/'/gu, "\\'") : body) + q;
  }
  if (Array.isArray(v)) {
    const inner = v.map((x) => pyRepr(x, Array.isArray(x) && (x as unknown as { __tuple?: boolean }).__tuple === true));
    if (tuple) return `(${inner.join(', ')}${v.length === 1 ? ',' : ''})`;
    return `[${inner.join(', ')}]`;
  }
  return String(v);
}

/** Mark an array so `pyRepr` prints it as a tuple. */
export function tuple<T extends unknown[]>(...items: T): T {
  Object.defineProperty(items, '__tuple', { value: true, enumerable: false });
  return items;
}

/** Group items into a Map keyed by a string key, keeping first-seen key order (a Python defaultdict(list)). */
export function groupBy<T>(items: Iterable<T>, key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}

/** Compact, collision-free key for a tuple of strings. */
export function tupleKey(...parts: unknown[]): string {
  return JSON.stringify(parts);
}

export function parseTupleKey<T extends unknown[]>(k: string): T {
  return JSON.parse(k) as T;
}

/** The Python type name an exception would have, for "<Name> during save" texts. */
export function errorTypeName(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; constructor?: { name?: string } };
    if (e.name && e.name !== 'Error') return e.name;
    if (e.constructor?.name) return e.constructor.name === 'Error' ? 'Exception' : e.constructor.name;
  }
  return 'Exception';
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
