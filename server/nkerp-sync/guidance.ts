/**
 * Turns a run report into the Sync tab's "Needs you" list: one item per problem or note, each with a plain
 * explanation of what happened and the instruction that would resolve it (which the user can send as is).
 */
import type { SyncReport } from './types.js';

export type AttentionKind = 'stopped' | 'cancelled' | 'history' | 'problem' | 'note';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: 'critical' | 'warning' | 'info';
  action: string;
  title: string;
  people: string[];
  detail: string;
  hint: string;
  /** An instruction the user can send from the Sync tab to act on this item (if any). */
  suggestion: string | null;
}

interface Rule {
  test: RegExp;
  hint: (m: RegExpMatchArray, ctx: { account: string | null }) => string;
  suggestion: string | null;
  severity?: AttentionItem['severity'];
}

const PROBLEM_RULES: Rule[] = [
  { test: /room already occupied by ([^:]+):/,
    hint: (m) => `The Sheet's room is still occupied by ${m[1]} on those nights, so nobody was moved in. This clears by itself `
      + 'once that tour leaves or is moved; if two full rooms are swapping, the next sync finishes it. If sharing the room '
      + 'is intended, run once allowing over capacity.',
    suggestion: 'Sync again' },
  { test: /building (.+) not (found|offered) in NKERP/,
    hint: (m) => `NKERP has no Najaf building called "${m[1]}" for this tour. Correct the BUILDING cell in the Sheet `
      + '(spelling must match NKERP), then sync again.',
    suggestion: 'Sync again' },
  { test: /room (\S+) not found in NKERP/,
    hint: (m) => `Room ${m[1]} does not exist in that building in NKERP. Correct the ROOM ALLOTTMENT cell in the Sheet, then sync again.`,
    suggestion: 'Sync again' },
  { test: /blocked\/inactive in NKERP/,
    hint: () => 'The room is blocked or inactive in NKERP. Unblock it in NKERP or pick another room in the Sheet, then sync again.',
    suggestion: 'Sync again' },
  { test: /Check this in NKERP before running again/,
    hint: () => 'A save could not be confirmed (it may have partly landed). Open this group in NKERP and check it, then '
      + 'sync again: a rerun is safe and only does what is still missing.',
    suggestion: 'Sync again', severity: 'critical' },
  { test: /more than (\d+) in one run; held all/,
    hint: (m) => `More than ${m[1]} people would be deallocated in one go, which usually means the Sheet was cleared or `
      + 'sorted by mistake, so all deallocations were held. Check the Sheet. If it really is right, allow the mass '
      + 'deallocation for one run.',
    suggestion: 'The Sheet is correct: sync and allow mass deallocation', severity: 'critical' },
  { test: /fewer than 10/,
    hint: () => 'The Sheet came back almost empty, so deallocations were held in case the read went wrong. Check the grid '
      + 'tab still has its rows, then sync again.',
    suggestion: 'Sync again', severity: 'critical' },
  { test: /service account can only view|not writable|Sync History/,
    hint: (_m, ctx) => `The app cannot write the Sync History tab, so deallocation was held and nothing was logged. Share `
      + `the Sheet as Editor with ${ctx.account ?? 'the configured Google service account'}, then sync again.`,
    suggestion: 'Sync again', severity: 'critical' },
  { test: /NKERP refused the save/,
    hint: () => 'NKERP refused the save and nothing landed. Check the room and tour in NKERP (locked, closed, or changed), '
      + 'then sync again.',
    suggestion: 'Sync again' },
];

const NOTE_RULES: Rule[] = [
  { test: /unreadable ARRIVAL/, hint: () => 'Type the ARRIVAL as a date (for example 26-11-2026) or make it a real date cell, then sync again.', suggestion: 'Sync again' },
  { test: /arrival date differs/, hint: () => 'The Sheet\'s ARRIVAL does not match any Najaf stay in NKERP for this person. Correct the date in the Sheet (or in NKERP), then sync again.', suggestion: 'Sync again' },
  { test: /duplicate ITS/, hint: () => 'The same ITS is on two rows of this tour with different rooms. Delete or fix one row, then sync again.', suggestion: 'Sync again' },
  { test: /family split/, hint: () => 'This family is split across rooms in the Sheet, so members without their own ITS row cannot be placed. Add each member\'s ITS to the right row.', suggestion: null },
  { test: /Sheet cleared but NKERP room differs/, hint: () => 'The Sheet cleared this person, but NKERP has them in a room someone changed by hand, so they were left alone on purpose. Deallocate them in NKERP if that is wanted.', suggestion: null },
  { test: /Sheet unclear for a previously synced/, hint: () => 'This person was synced before, but the Sheet now lists them ambiguously (duplicate or family split). Fix the Sheet rows.', suggestion: null },
  { test: /deallocated only the last synced room/, hint: () => 'Only the nights in the room the app last synced were removed; other NKERP nights were left as they are.', suggestion: null },
];

function match(rules: Rule[], text: string, account: string | null): { hint: string; suggestion: string | null; severity?: AttentionItem['severity'] } {
  for (const rule of rules) {
    const m = text.match(rule.test);
    if (m) return { hint: rule.hint(m, { account }), suggestion: rule.suggestion, severity: rule.severity };
  }
  return { hint: '', suggestion: null };
}

export function attention(report: SyncReport | null, account: string | null = null): AttentionItem[] {
  if (!report) return [];
  const items: AttentionItem[] = [];
  if (report.stopped) {
    items.push({ id: 'stopped', kind: 'stopped', severity: 'critical', action: 'stop', title: 'The run stopped',
      people: [], detail: report.stopped,
      hint: 'A save could not be confirmed, so no further saves were made. Check that group in NKERP, then sync again (a rerun is safe).',
      suggestion: 'Sync again' });
  }
  if (report.cancelled) {
    items.push({ id: 'cancelled', kind: 'cancelled', severity: 'info', action: 'cancel', title: 'The run was cancelled',
      people: [], detail: report.cancelled, hint: 'Sync again to finish the remaining changes.', suggestion: 'Sync again' });
  }
  report.problems.forEach((p, i) => {
    const g = match(PROBLEM_RULES, `${p.group} ${p.reason}`, account);
    items.push({ id: `p${i}`, kind: p.action === 'history' ? 'history' : 'problem',
      severity: g.severity ?? 'warning', action: p.action, title: p.group, people: p.people, detail: p.reason,
      hint: g.hint || 'See the detail, fix the Sheet or NKERP as needed, then sync again.', suggestion: g.suggestion });
  });
  for (const [kind, entries] of Object.entries(report.notes)) {
    const g = match(NOTE_RULES, kind, account);
    entries.forEach((e, i) => {
      items.push({ id: `n:${kind}:${i}`, kind: 'note', severity: 'info', action: 'note', title: kind, people: [], detail: e,
        hint: g.hint, suggestion: g.suggestion });
    });
  }
  return items;
}
