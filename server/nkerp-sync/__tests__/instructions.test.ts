/** The Sync tab's instruction interpreter (rules path) and the "Needs you" guidance. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attention } from '../guidance';
import { findDate, interpretRules, proposalFromModel, type InstructionContext } from '../instructions';
import type { SyncReport } from '../types';

const report: SyncReport = {
  today: '2026-11-16', mode: 'apply',
  done: [{ action: 'allocate', group: '2026-11-20 NKERP/TOUR/2026/2211 Saifee 107', people: ['Ali'], dates: ['2026-11-20'], by: ['ITS'] }],
  planned: [],
  problems: [
    { action: 'reallocate', group: 'NKERP/TOUR/2026/2211 Saifee 108', people: ['Husain'],
      reason: 'room already occupied by NKERP/TOUR/2026/3044: 2026-11-20: 4 already + 1 new > 4 beds' },
    { action: 'deallocate', group: 'NKERP/TOUR/2026/4100 Zahra (ITS 123) Burhani 201', people: ['Zahra'],
      reason: "30 people to deallocate is more than 20 in one run; held all. Check the Sheet wasn't cleared by mistake, then rerun with --allow-mass-deallocation if it is right." },
  ],
  notes: { 'unreadable ARRIVAL date in the Sheet (row skipped)': ["row 12 NKERP/TOUR/2026/2211 'next week'"] },
  skipped: {}, history: { rows_written: 3 },
};
const ctx: InstructionContext = { today: '2026-11-16', running: false, report, account: 'svc@example.com' };
const say = (t: string, c: Partial<InstructionContext> = {}) => interpretRules(t, { ...ctx, ...c });

describe('instruction rules', () => {
  it('maps plain commands to the button run', () => {
    for (const t of ['sync', 'Sync now', 'retry', 'run it again', 'go ahead', 'do it', 'try again please', 'can you sync again?', 'run again?']) {
      const p = say(t);
      assert.equal(p.intent, 'sync', t);
      assert.deepEqual(p.options, { apply: true }, t);
      assert.equal(p.needsConfirmation, false, t);
    }
  });

  it('maps previews to dry runs', () => {
    for (const t of ['preview', 'dry run', 'what would it do?', 'check what would happen', 'simulate a sync']) {
      const p = say(t);
      assert.equal(p.intent, 'preview', t);
      assert.equal(p.options!.apply, false, t);
    }
  });

  it('restricts or excludes actions', () => {
    assert.deepEqual(say('only allocations').options!.only, ['allocate']);
    assert.deepEqual(say('just reallocate').options!.only, ['reallocate']);
    assert.deepEqual(say('sync but skip deallocations').options!.only, ['allocate', 'reallocate']);
    assert.deepEqual(say('sync everything except reallocation').options!.only, ['allocate', 'deallocate']);
    assert.deepEqual(say('preview deallocations and reallocations only').options!.only, ['reallocate', 'deallocate']);
    assert.equal(say('sync').options!.only, undefined);
  });

  it('reads start dates', () => {
    assert.equal(say('preview tomorrow').options!.today, '2026-11-17');
    assert.equal(say('sync from 20 Nov').options!.today, '2026-11-20');
    assert.equal(say('sync from 2026-12-01').options!.today, '2026-12-01');
    assert.equal(say('sync from 03/01/2027').options!.today, '2027-01-03');
    assert.equal(findDate('preview jan 5', '2026-11-16'), '2027-01-05');
    assert.equal(findDate('sync from 20/11', '2026-11-16'), '2026-11-20');
    assert.equal(say('sync').options!.today, undefined);
  });

  it('reads one arrival date and a date range', () => {
    const scope = (t: string) => { const o = say(t).options!; return [o.from, o.to, o.today]; };
    assert.deepEqual(scope('sync 25 Nov only'), ['2026-11-25', '2026-11-25', undefined]);
    assert.deepEqual(scope('preview arrivals on 2026-11-25'), ['2026-11-25', '2026-11-25', undefined]);
    assert.deepEqual(scope('sync only 25 Nov'), ['2026-11-25', '2026-11-25', undefined]);
    assert.deepEqual(scope('sync for tomorrow'), ['2026-11-17', '2026-11-17', undefined]);
    assert.deepEqual(scope('sync on 20/11'), ['2026-11-20', '2026-11-20', undefined]);
    assert.deepEqual(scope('sync 20-25 Nov'), ['2026-11-20', '2026-11-25', undefined]);
    assert.deepEqual(scope('preview between 1 Dec and 3 Dec'), ['2026-12-01', '2026-12-03', undefined]);
    assert.deepEqual(scope('sync from 20 Nov to 2 Dec'), ['2026-11-20', '2026-12-02', undefined]);
    assert.deepEqual(scope('sync 2026-11-22 to 2026-11-20'), ['2026-11-20', '2026-11-22', undefined]);
    assert.deepEqual(scope('sync from 20 Nov'), [undefined, undefined, '2026-11-20']);
    assert.equal(say('sync only 25 Nov').options!.limit, undefined);
    assert.equal(say('sync only 3 groups').options!.limit, 3);
    assert.match(say('sync 20-25 Nov').reply, /only arrivals from 2026-11-20 to 2026-11-25/);
  });

  it('reads a trial limit', () => {
    assert.equal(say('try just the first 2 groups').options!.limit, 2);
    assert.equal(say('sync, limit 5').options!.limit, 5);
  });

  it('safety overrides only on explicit words, and always ask to confirm', () => {
    const mass = say('The sheet is correct, go ahead with the deallocations');
    assert.equal(mass.intent, 'sync');
    assert.equal(mass.options!.allowMassDeallocation, true);
    assert.equal(mass.needsConfirmation, true);
    const over = say('sync and allow over capacity for this run');
    assert.equal(over.options!.allowOverCapacity, true);
    assert.equal(over.needsConfirmation, true);
    assert.equal(say('sync again').options!.allowOverCapacity, undefined);
    assert.equal(say('sync again').options!.allowMassDeallocation, undefined);
    // a preview with an override is harmless: no confirmation needed
    assert.equal(say('preview allowing over capacity').needsConfirmation, false);
    assert.equal(say('sync with up to 40 deallocations').options!.maxDeallocations, 40);
  });

  it('a request scoped to one tour or room asks for confirmation, because runs cover the whole Sheet', () => {
    const p = say('retry Saifee 107');
    assert.equal(p.intent, 'sync');
    assert.equal(p.needsConfirmation, true);
    assert.match(p.cautions![0], /every tour/);
    assert.equal(say('preview tour 2211').needsConfirmation, false);
  });

  it('questions are explained from the last report, never run', () => {
    for (const t of ['why was Saifee 108 held?', 'what needs fixing', 'does it allocate infants?', 'did the sync work?']) {
      assert.equal(say(t).intent, 'explain', t);
    }
    const p = say('why was 108 not moved?');
    assert.match(p.reply, /NKERP\/TOUR\/2026\/3044/);
    assert.match(p.reply, /occupied/);
    assert.match(say('what happened?', { report: null }).reply, /no finished run/);
  });

  it('cancel, status, help, nonsense', () => {
    assert.equal(say('stop', { running: true }).intent, 'cancel');
    assert.equal(say('cancel the sync').intent, 'cancel');
    assert.equal(say("don't stop, sync").intent, 'sync');
    assert.equal(say('is it still running?').intent, 'status');
    assert.equal(say('help').intent, 'help');
    assert.equal(say('make me a sandwich').intent, 'unsupported');
  });
});

describe('model output validation', () => {
  it('accepts a well-formed proposal and recomputes confirmation', () => {
    const p = proposalFromModel({ intent: 'sync', only: ['allocate', 'bogus'], startDate: '2026-11-18', limit: 3,
      allowMassDeallocation: true, reply: 'x' }, ctx);
    assert.deepEqual(p.options, { apply: true, only: ['allocate'], today: '2026-11-18', limit: 3, allowMassDeallocation: true });
    assert.equal(p.needsConfirmation, true);
  });

  it('accepts an arrival scope from the model', () => {
    const p = proposalFromModel({ intent: 'preview', arrivalFrom: '2026-11-25', reply: 'x' }, ctx);
    assert.deepEqual(p.options, { apply: false, from: '2026-11-25', to: '2026-11-25' });
    assert.throws(() => proposalFromModel({ intent: 'sync', arrivalFrom: '2026-02-31', reply: '' }, ctx));
  });

  it('rejects malformed output', () => {
    assert.throws(() => proposalFromModel({ intent: 'delete_everything', reply: '' }, ctx));
    assert.throws(() => proposalFromModel({ intent: 'sync', startDate: '2026-13-45', reply: '' }, ctx));
    assert.throws(() => proposalFromModel(null, ctx));
  });
});

describe('needs-you guidance', () => {
  it('turns problems and notes into actionable items', () => {
    const items = attention({ ...report, stopped: 'unconfirmed allocate (x); stopped further saves',
      history: { error: 'the Google service account can only view the Sheet' },
      problems: [...report.problems, { action: 'history', group: 'Sync History', people: [], reason: 'the Google service account can only view the Sheet; share' }] },
    'svc@example.com');
    assert.equal(items[0].kind, 'stopped');
    const occupied = items.find((i) => i.detail.includes('occupied'))!;
    assert.match(occupied.hint, /3044/);
    const mass = items.find((i) => i.detail.includes('held all'))!;
    assert.equal(mass.severity, 'critical');
    assert.match(mass.suggestion!, /allow mass deallocation/);
    const hist = items.find((i) => i.kind === 'history')!;
    assert.match(hist.hint, /svc@example\.com/);
    const note = items.find((i) => i.kind === 'note')!;
    assert.match(note.hint, /ARRIVAL/);
    // and the suggestion text round-trips through the interpreter to the intended run
    assert.equal(say(mass.suggestion!).options!.allowMassDeallocation, true);
  });
});
