/**
 * A record of every B→A (Category B to A) shift slip made in the app: printed or downloaded as PDF.
 * Reprinting the same slip (same slip number and the same zaereen) adds to that record instead of making a new one.
 * Records are kept for 400 days.
 */
import { createHash } from 'node:crypto';
import type { Reservation } from '../src/types/index.js';
import { guests, read, transaction, write } from './accommodation-store.js';

export interface SlipPax { reservationId: string; its: string; name: string; tour: string; office: string;
  arrival: string; departure: string; room: string; category: string; moneyGiven: string }
export interface SlipRecord {
  id: string;
  slipNo: string;
  direction: 'B_TO_A';
  createdAt: string;
  /** Each time the slip was printed or downloaded. */
  issues: { at: string; action: 'print' | 'pdf' }[];
  tours: string[];
  offices: string[];
  paxCount: number;
  amountNote: string;
  pax: SlipPax[];
}

export class SlipError extends Error {}
export const slips = () => read<SlipRecord[]>('slips', []);

export function recordSlip(input: unknown, now = Date.now()): SlipRecord {
  const body = (input ?? {}) as { slipNo?: unknown; reservationIds?: unknown; amountNote?: unknown; action?: unknown; direction?: unknown };
  if (body.direction !== undefined && body.direction !== 'B_TO_A') throw new SlipError('Only B→A slips are recorded.');
  const slipNo = String(body.slipNo ?? '').trim().slice(0, 80);
  const ids = Array.isArray(body.reservationIds) ? [...new Set(body.reservationIds.filter((x): x is string => typeof x === 'string'))] : [];
  if (!slipNo || !ids.length || ids.length > 500) throw new SlipError('A slip needs its number and at least one zair.');
  const action = body.action === 'pdf' ? 'pdf' : 'print';
  const stamp = new Date(now).toISOString();
  return transaction(() => {
    const byId = new Map(guests().map(r => [r.id, r as Reservation]));
    const pax: SlipPax[] = ids.map(id => {
      const r = byId.get(id);
      if (!r) throw new SlipError('A zair on this slip is no longer in the app. Reload and try again.');
      return { reservationId: id, its: String(r.itsId ?? ''), name: r.applicantName || '', tour: r.tourRefNo || r.tourId || '',
        office: r.officeName || '', arrival: [r.arrivalDate, r.arrivalTime].filter(Boolean).join(' '),
        departure: [r.departureDate, r.departureTime].filter(Boolean).join(' '),
        room: [r.building, r.roomNumber].filter(Boolean).join(' '), category: r.category || '', moneyGiven: r.moneyGiven || 'No' };
    });
    const key = createHash('sha256').update(JSON.stringify([slipNo, [...ids].sort()])).digest('hex').slice(0, 24);
    const all = slips();
    const existing = all.find(s => s.id === key);
    const amountNote = String(body.amountNote ?? '').trim().slice(0, 300);
    const record: SlipRecord = existing
      ? { ...existing, issues: [...existing.issues, { at: stamp, action }], pax, amountNote: amountNote || existing.amountNote }
      : { id: key, slipNo, direction: 'B_TO_A', createdAt: stamp, issues: [{ at: stamp, action }],
        tours: [...new Set(pax.map(p => p.tour).filter(Boolean))], offices: [...new Set(pax.map(p => p.office).filter(Boolean))],
        paxCount: pax.length, amountNote, pax };
    const cutoff = now - 400 * 86_400_000;
    const next = [record, ...all.filter(s => s.id !== key && Date.parse(s.createdAt) > cutoff)];
    write('slips', next);
    return record;
  });
}
