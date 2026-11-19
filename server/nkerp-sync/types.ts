/** Shapes shared by the Najaf -> NKERP sync engine, its job manager and the HTTP routes. */

export type SyncAction = 'allocate' | 'reallocate' | 'deallocate';
export const ALL_ACTIONS: readonly SyncAction[] = ['allocate', 'reallocate', 'deallocate'];

/** One row of the 'Zaereen Lodging & Room Allotment Grid' tab, normalised. */
export interface SheetRow {
  row: number;
  its: string;
  name: string;
  family: string;
  ref: string;
  building: string;
  room: string;
  arrival: string | null;
  arrival_text: string;
}

/** The subset of an NKERP record the engine reads. NKERP sends many more fields; they are passed through. */
export type NkRecord = Record<string, any>;

export interface Night {
  day: string;
  building: string;
  room: string;
  row: NkRecord;
  entry: NkRecord;
}

export interface Person {
  its: string;
  aid: unknown;
  ref: string;
  tour_id: unknown;
  name: string;
  family: string;
  nights: Night[];
}

export interface SheetIndex {
  its_room: Map<string, [string, string]>;
  dupes: Set<string>;
  fam_rooms: Map<string, Map<string, [string, string]>>;
}

export type Resolution =
  | { kind: 'room'; target: [string, string]; how: string }
  | { kind: 'dupe' | 'split'; target: null; how: string }
  | { kind: 'none'; target: null; how: '' };

export interface AllocItem {
  arrival: string;
  ref: string;
  building: string;
  room: string;
  how: string;
  app: NkRecord;
  dates: NkRecord[];
}

export interface Move {
  ref: string;
  person: Person;
  building: string;
  room: string;
  how: string;
  nights: Night[];
  from: string[];
}

export interface MemoryEntry {
  building: string;
  room: string;
  arrival: string;
  name: string;
}

export interface Removal {
  ref: string;
  its: string;
  name: string;
  arrival: string;
  was: [string, string];
  person: Person | undefined;
  nights: Night[];
}

export interface Cleared {
  ref: string;
  its: string;
  name: string;
  arrival: string;
  was: [string, string];
  details: string;
}

export interface StateEntry {
  building: string;
  room: string;
  how: string;
  name: string;
  arrival: string;
}

export type Notes = Record<string, string[]>;
export type Skipped = Record<string, number>;

export interface ReportEntry {
  action: SyncAction;
  group: string;
  people: string[];
  dates: string[];
  by: string[];
  from?: string[];
  over_capacity?: string[];
  warning?: string;
}

export interface ReportProblem {
  action: SyncAction | 'history';
  group: string;
  people: string[];
  reason: string;
}

export interface SyncReport {
  today: string;
  mode: 'apply' | 'dry-run';
  /** Set when the run was limited to arrivals on these dates (inclusive). */
  scope?: { from: string; to: string };
  done: ReportEntry[];
  planned: ReportEntry[];
  problems: ReportProblem[];
  notes: Notes;
  skipped: Skipped;
  stopped?: string;
  cancelled?: string;
  history?: { rows_written?: number; rows_planned?: number; error?: string };
}

/** One 'Sync History' row (column name -> value). */
export type HistoryRow = Record<string, string>;

export interface RunOptions {
  /** Write to NKERP and the Sync History tab. False = dry run (preview). */
  apply: boolean;
  /** YYYY-MM-DD start date; default today in Asia/Baghdad. */
  today?: string;
  /**
   * Arrival scope (inclusive, YYYY-MM-DD): only stays whose Sheet ARRIVAL falls from `from` to `to` are
   * allocated, reallocated or deallocated. One date = from and to the same day. Unset = every arrival.
   */
  from?: string;
  to?: string;
  /** Subset of actions; default all three. */
  only?: SyncAction[];
  /** Only when the user explicitly says so for this run. */
  allowOverCapacity?: boolean;
  /** Hold all deallocations when more people than this (default 20). */
  maxDeallocations?: number;
  /** Only when the user explicitly says so for this run. */
  allowMassDeallocation?: boolean;
  /** Only the first N write groups (a trial run). */
  limit?: number | null;
}

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

export interface ProgressEvent {
  level: LogLevel;
  stage: string;
  message: string;
  /** Optional progress fraction for the current stage. */
  current?: number;
  total?: number;
  data?: Record<string, unknown>;
}

export type ProgressSink = (ev: ProgressEvent) => void;
