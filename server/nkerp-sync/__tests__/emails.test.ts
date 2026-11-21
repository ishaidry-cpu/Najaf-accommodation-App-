/**
 * Najaf accommodation emails: offline, against an in-memory NKERP "View Tour Accommodation Status" list.
 *   npm run test:sync
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type EmailApi, type EmailPayload, EMAIL_ENDPOINTS, najafSchedule, NkerpEmailClient, type Recipient, runEmails,
  SEND_TO_OPERATOR, SEND_TO_ZAEREEN, TOUR_LIST, validateEmailRequest,
} from '../emails';
import { dispatch } from '../handlers';
import { NkerpClient, Rejected } from '../nkerpClient';
import type { NkRecord } from '../types';

const TODAY = '2026-11-19';

function plan(tourId: number, sub: 3 | 4, start: string, status = 1, toSent = false, appSent = false, name?: string): NkRecord {
  return { TourId: tourId, VenueId: 2, SubvenueId: sub, SubvenueName: name ?? (sub === 3 ? 'NAJAF' : 'KARBALA'),
    StartDateTimeZone: `${start}T14:00:00`, EndDateTimeZone: `${start}T08:00:00`, AccomudationStatusID: status,
    IsMailSentToTO: toSent, IsMailSentToApplicants: appSent };
}

function tour(ref: string, plans: NkRecord[], extra: NkRecord = {}): NkRecord {
  return { TourReferenceId: ref, TOName: 'Hatimi Tours', OfficeName: 'Mumbai', PaxCount: 12, ArrivalDate: '2026-11-18T11:00:00',
    DepartureDate: '2026-11-28T08:00:00', TourSubvenuePlan: plans, ...extra };
}

class FakeEmailNkerp implements EmailApi {
  rows: NkRecord[];
  readonly sends: [Recipient, EmailPayload][] = [];
  reads = 0;
  constructor(rows: NkRecord[], readonly behaviour: (to: Recipient, p: EmailPayload) => NkRecord | Error = () => ({ ReturnStatus: true, ReturnMessage: ['Mail sent'] })) {
    this.rows = rows;
  }

  async tourList(): Promise<NkRecord[]> {
    this.reads++;
    return structuredClone(this.rows);
  }

  async send(to: Recipient, payload: EmailPayload): Promise<NkRecord> {
    this.sends.push([to, payload]);
    const out = this.behaviour(to, payload);
    if (out instanceof Error) throw out;
    if (out.ReturnStatus !== false) {
      for (const r of this.rows) {
        for (const p of r.TourSubvenuePlan) {
          if (p.TourId === payload.TourId && p.StartDateTimeZone === payload.StartDateTimeZone && p.SubvenueId === payload.SubvenueId) {
            if (to === 'operator') p.IsMailSentToTO = true;
            else p.IsMailSentToApplicants = true;
          }
        }
      }
    }
    return out;
  }
}

const rows = () => [
  tour('NKERP/TOUR/2026/2211', [plan(2211, 4, '2026-11-20'), plan(2211, 3, '2026-11-24')]),            // Karbala then Najaf
  tour('NKERP/TOUR/2026/3044', [plan(3044, 3, '2026-11-24', 2, true)]),                                // partial, TO already sent
  tour('NKERP/TOUR/2026/4100', [plan(4100, 3, '2026-11-26', 3)]),                                      // not assigned
  tour('NKERP/TOUR/2026/1000', [plan(1000, 3, '2026-11-10')]),                                         // Najaf stay in the past
];

describe('the Najaf email list', () => {
  it('keeps only Najaf stays from today, grouped by Najaf check-in day', () => {
    const list = najafSchedule(rows(), TODAY);
    assert.deepEqual(list.days.map((d) => [d.date, d.stays.map((s) => s.key)]), [
      ['2026-11-24', ['2211|2026-11-24', '3044|2026-11-24']],
      ['2026-11-26', ['4100|2026-11-26']],
    ]);
    const s = list.days[0].stays[1];
    assert.deepEqual([s.ref, s.allotment, s.operatorSent, s.zaereenSent, s.pax, s.operator], ['NKERP/TOUR/2026/3044', 'partial', true, false, 12, 'Hatimi Tours']);
    assert.equal(list.days[1].stays[0].allotment, 'none');
  });

  it('never lists a Karbala stay, and leaves out a sub-venue whose id and name disagree', () => {
    const list = najafSchedule([tour('T/1', [plan(1, 4, '2026-11-25')]), tour('T/2', [plan(2, 3, '2026-11-25', 1, false, false, 'KARBALA')])], TODAY);
    assert.deepEqual(list.days, []);
    assert.equal(list.excluded.length, 1);
    assert.match(list.excluded[0], /T\/2: sub-venue id 3 is named "KARBALA"/);
  });
});

describe('sending', () => {
  it('sends each email to its own endpoint with the payload rebuilt from NKERP', async () => {
    const fake = new FakeEmailNkerp(rows());
    const { results, summary } = await runEmails([
      { stay: '2211|2026-11-24', to: 'zaereen' }, { stay: '2211|2026-11-24', to: 'operator' },
    ], { api: fake, today: TODAY });
    assert.deepEqual(fake.sends, [
      ['operator', { StartDateTimeZone: '2026-11-24T14:00:00', SubvenueId: 3, TourId: 2211, VenueId: 2 }],
      ['zaereen', { StartDateTimeZone: '2026-11-24T14:00:00', SubvenueId: 3, TourId: 2211, VenueId: 2 }],
    ]);
    assert.deepEqual(results.map((r) => r.outcome), ['confirmed', 'confirmed']);
    assert.equal(summary.confirmed, 2);
    assert.equal(fake.reads, 2, 'one read before sending, one to confirm');
  });

  it('never sends for a Karbala stay, a past stay or a stay with no rooms assigned', async () => {
    const fake = new FakeEmailNkerp(rows());
    const { results } = await runEmails([
      { stay: '2211|2026-11-20', to: 'operator' },     // that is the Karbala stay
      { stay: '1000|2026-11-10', to: 'operator' },
      { stay: '4100|2026-11-26', to: 'zaereen' },
    ], { api: fake, today: TODAY });
    assert.deepEqual(fake.sends, []);
    assert.deepEqual(results.map((r) => r.outcome), ['skipped', 'skipped', 'skipped']);
    assert.match(results.find((r) => r.stay.startsWith('4100'))!.message, /no rooms are assigned/);
  });

  it('skips an already-sent email unless a resend is asked for', async () => {
    const fake = new FakeEmailNkerp(rows());
    const first = await runEmails([{ stay: '3044|2026-11-24', to: 'operator' }], { api: fake, today: TODAY });
    assert.deepEqual([first.results[0].outcome, fake.sends.length], ['skipped', 0]);
    const again = await runEmails([{ stay: '3044|2026-11-24', to: 'operator', resend: true }], { api: fake, today: TODAY });
    assert.deepEqual([again.results[0].outcome, fake.sends.length], ['confirmed', 1]);
  });

  it('reports a refusal and carries on', async () => {
    const fake = new FakeEmailNkerp(rows(), (to) => (to === 'operator' ? new Rejected('NKERP refused: no TO email id') : { ReturnStatus: true }));
    const { results, summary } = await runEmails([
      { stay: '2211|2026-11-24', to: 'operator' }, { stay: '2211|2026-11-24', to: 'zaereen' },
    ], { api: fake, today: TODAY });
    assert.deepEqual(results.map((r) => r.outcome), ['refused', 'confirmed']);
    assert.equal(summary.stopped, null);
  });

  it('a ReturnStatus false answer is a refusal', async () => {
    const fake = new FakeEmailNkerp(rows(), () => ({ ReturnStatus: false, ReturnMessage: ['Email id missing'] }));
    const { results } = await runEmails([{ stay: '2211|2026-11-24', to: 'operator' }], { api: fake, today: TODAY });
    assert.deepEqual([results[0].outcome, results[0].message], ['refused', 'NKERP refused: Email id missing']);
  });

  it('stops after a send with no clear answer, and never retries it', async () => {
    const timeout = Object.assign(new Error('could not reach to.najafkarbala.com: no answer in time'), { name: 'TimeoutError' });
    const fake = new FakeEmailNkerp(rows(), () => timeout);
    const { results, summary } = await runEmails([
      { stay: '2211|2026-11-24', to: 'operator' }, { stay: '2211|2026-11-24', to: 'zaereen' },
    ], { api: fake, today: TODAY });
    assert.equal(fake.sends.length, 1);
    assert.deepEqual(results.map((r) => r.outcome), ['uncertain', 'not-run']);
    assert.match(summary.stopped!, /no clear answer/);
  });

  it('a stop from the page lets the current send finish and starts no new one', async () => {
    const controller = new AbortController();
    const fake = new FakeEmailNkerp(rows(), () => {
      controller.abort();
      return { ReturnStatus: true };
    });
    const { results } = await runEmails([
      { stay: '2211|2026-11-24', to: 'operator' }, { stay: '2211|2026-11-24', to: 'zaereen' },
    ], { api: fake, today: TODAY, signal: controller.signal });
    assert.deepEqual(results.map((r) => r.outcome), ['confirmed', 'not-run']);
  });
});

describe('email requests', () => {
  it('validates and de-duplicates', () => {
    assert.deepEqual(validateEmailRequest({ confirm: true, items: [
      { stay: '2211|2026-11-24', to: 'operator' }, { stay: '2211|2026-11-24', to: 'operator' }, { stay: '2211|2026-11-24', to: 'zaereen', resend: true },
    ] }), [{ stay: '2211|2026-11-24', to: 'operator' }, { stay: '2211|2026-11-24', to: 'zaereen', resend: true }]);
    assert.throws(() => validateEmailRequest({ confirm: true, items: [] }), /at least one/);
    assert.throws(() => validateEmailRequest({ items: [{ stay: '1|2026-11-24', to: 'operator' }] }), /confirm/);
    assert.throws(() => validateEmailRequest({ confirm: true, items: [{ stay: '1|2026-11-24', to: 'everyone' }] }), /operator or the zaereen/);
    assert.throws(() => validateEmailRequest({ confirm: true, items: [{ stay: 'nope', to: 'operator' }] }), /name a stay/);
  });

  it('the email client can only list and send, and the room sync client can never send an email', async () => {
    const email = new NkerpEmailClient({ allowWrite: true }).client;
    await assert.rejects(email.read('api/property/getRoomallocationSearchResult', {}), /not a read endpoint/);
    await assert.rejects(email.write('api/Property/DeallocateApplicants', {}), /not a write endpoint/);
    const sync = new NkerpClient({ allowWrite: true });
    await assert.rejects(sync.write(SEND_TO_OPERATOR, {}), /not a write endpoint/);
    await assert.rejects(sync.write(SEND_TO_ZAEREEN, {}), /not a write endpoint/);
    await assert.rejects(sync.read(TOUR_LIST, {}), /not a read endpoint/);
    const readOnly = new NkerpEmailClient().client;
    await assert.rejects(readOnly.write(SEND_TO_OPERATOR, {}), /write disabled/);
    assert.deepEqual(EMAIL_ENDPOINTS.writes, ['api/Property/getTourAccommodationPlan', 'api/Property/sentAccommodationPlanToApplicants/']);
  });
});

describe('reading the tour list', () => {
  it('accepts a tour NKERP lists twice (its total counts both rows) and still refuses a cut-off list', async () => {
    const dup = tour('NKERP/TOUR/2026/3574', [plan(3574, 3, '2026-11-28')]);
    const pages: Record<number, NkRecord[]> = { 1: [rows()[0], dup], 2: [dup] };
    const client = new NkerpEmailClient();
    client.client.read = (async (_p: string, body: any) => ({ listTourAccommotionDetails: structuredClone(pages[body.currentPage] ?? []), TotalRows: 3 })) as any;
    const got = await client.tourList('2026-10-05');
    assert.deepEqual(got.map((r) => r.TourReferenceId), ['NKERP/TOUR/2026/2211', 'NKERP/TOUR/2026/3574']);
    pages[2] = [];
    await assert.rejects(client.tourList('2026-10-05'), /stopped at 2 of 3 rows/);
    pages[2] = [rows()[0], dup];
    client.client.read = (async (_p: string, body: any) => ({ listTourAccommotionDetails: structuredClone(pages[body.currentPage === 1 ? 2 : 2]), TotalRows: 5 })) as any;
    await assert.rejects(client.tourList('2026-10-05'), /repeated a page/);
  });
});

describe('email HTTP handlers', () => {
  const creds = () => ({ nkerp: true, problem: null });

  it('lists the Najaf stays', async () => {
    const fake = new FakeEmailNkerp(rows());
    const res = await dispatch('emails', new Request('http://x/api/nkerp-sync/emails'), { emailApi: () => fake, credentials: creds, today: () => TODAY });
    const body = await res.json() as any;
    assert.equal(res.status, 200);
    assert.deepEqual(body.days.map((d: any) => d.date), ['2026-11-24', '2026-11-26']);
  });

  it('streams a send and reports the outcome', async () => {
    const fake = new FakeEmailNkerp(rows());
    const res = await dispatch('emails-send', new Request('http://x/api/nkerp-sync/emails-send', { method: 'POST',
      body: JSON.stringify({ confirm: true, items: [{ stay: '2211|2026-11-24', to: 'zaereen' }] }) }),
    { emailApi: () => fake, credentials: creds, today: () => TODAY, maxSeconds: 0 });
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines[0].type, 'start');
    const done = lines[lines.length - 1];
    assert.deepEqual([done.type, done.summary.confirmed, done.results[0].outcome], ['done', 1, 'confirmed']);
  });

  it('refuses a send without confirmation', async () => {
    const res = await dispatch('emails-send', new Request('http://x/api/nkerp-sync/emails-send', { method: 'POST',
      body: JSON.stringify({ items: [{ stay: '2211|2026-11-24', to: 'zaereen' }] }) }), { emailApi: () => new FakeEmailNkerp(rows()), credentials: creds });
    assert.equal(res.status, 400);
  });
});
