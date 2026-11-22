/**
 * Who should be roomed together.
 *
 * Within a tour, zaereen are one family group when:
 *  1. they share a GROUP_ID (set when a group was imported with one), or else
 *  2. they share an NKERP family number (F-1, F-2 …) with someone else on the tour, or else
 *  3. each has a family number of their own (or none) and they share a HOF ID. Some tours give every
 *     zair their own family number, so the HOF ID is the only thing that shows who belongs together.
 *
 * Family numbers that already hold several people are never merged through the HOF ID: tours often
 * put grown-up children's families in their own family number on purpose.
 */
import type { Reservation } from '../types';

export interface FamilyGroup {
  /** Identity within the tour, e.g. `f:F-3`, `h:20304504`, `g:1766839506` or `i:30318214`. */
  key: string;
  /** What staff see, e.g. `F-3` or `F-519, F-522`. */
  label: string;
  /** How the group was formed. */
  basis: 'group' | 'family' | 'hof' | 'single';
  /** Set when the group joins several family numbers, to explain why they share a room. */
  note?: string;
}

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();
const its = (r: Reservation) => String(r.itsId ?? '').replace(/^['’]/, '').trim();
const tourOf = (r: Reservation) => lower(r.tourRefNo || r.tourId);

/** 'F-7', 'F7', 'f - 07', '7' -> 'F-7'; any other text is kept as is. */
export function familyLabel(value: unknown): string {
  const raw = String(value ?? '').trim();
  const m = /^F?\s*-?\s*0*(\d+)$/i.exec(raw);
  return m ? `F-${parseInt(m[1], 10)}` : raw;
}

const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function joinLabels(labels: string[]) {
  const list = [...new Set(labels.filter(Boolean))].sort(byNumber);
  if (list.length <= 3) return list.join(', ');
  return `${list.slice(0, 2).join(', ')} +${list.length - 2}`;
}

/** reservation id → family group, for every reservation that has a tour. */
export function familyGroups(reservations: Reservation[]): Map<string, FamilyGroup> {
  const byTour = new Map<string, Reservation[]>();
  for (const r of reservations) {
    const t = tourOf(r);
    if (t) byTour.set(t, [...(byTour.get(t) || []), r]);
  }
  const out = new Map<string, FamilyGroup>();
  for (const list of byTour.values()) {
    // Distinct people per family number and per HOF on this tour (repeat records of one zair count once).
    const people = (r: Reservation) => its(r) || r.id;
    const famPeople = new Map<string, Set<string>>();
    for (const r of list) {
      const f = lower(familyLabel(r.family));
      if (f) famPeople.set(f, (famPeople.get(f) || new Set()).add(people(r)));
    }
    const ownFamily = (r: Reservation) => (famPeople.get(lower(familyLabel(r.family)))?.size || 0) <= 1;
    const hofPeople = new Map<string, Set<string>>();
    const hofLabels = new Map<string, string[]>();
    for (const r of list) {
      const hof = lower(r.hofId);
      if (!hof || lower(r.groupId) || !ownFamily(r)) continue;
      hofPeople.set(hof, (hofPeople.get(hof) || new Set()).add(people(r)));
      hofLabels.set(hof, [...(hofLabels.get(hof) || []), familyLabel(r.family)]);
    }
    const groupLabels = new Map<string, string[]>();
    for (const r of list) {
      const g = lower(r.groupId);
      if (g) groupLabels.set(g, [...(groupLabels.get(g) || []), familyLabel(r.family)]);
    }

    for (const r of list) {
      const label = familyLabel(r.family);
      const g = lower(r.groupId);
      if (g) {
        const labels = groupLabels.get(g)!;
        const joined = joinLabels(labels);
        out.set(r.id, {
          key: `g:${g}`, label: joined || `Group ${r.groupId}`, basis: 'group',
          note: new Set(labels).size > 1 ? `One group (ID ${String(r.groupId).trim()})` : undefined,
        });
        continue;
      }
      if (label && !ownFamily(r)) {
        out.set(r.id, { key: `f:${lower(label)}`, label, basis: 'family' });
        continue;
      }
      const hof = lower(r.hofId);
      if (hof && (hofPeople.get(hof)?.size || 0) > 1) {
        out.set(r.id, {
          key: `h:${hof}`, label: joinLabels(hofLabels.get(hof)!) || `HOF ${String(r.hofId).trim()}`, basis: 'hof',
          note: `One household: same HOF ID ${String(r.hofId).trim()}`,
        });
        continue;
      }
      out.set(r.id, label
        ? { key: `f:${lower(label)}`, label, basis: 'single' }
        : { key: `i:${lower(its(r) || r.id)}`, label: `ITS ${its(r)}`, basis: 'single' });
    }
  }
  return out;
}

/** The group for one reservation, falling back to its own family number. */
export function groupOf(groups: Map<string, FamilyGroup>, r: Reservation): FamilyGroup {
  const found = groups.get(r.id);
  if (found) return found;
  const label = familyLabel(r.family);
  return label ? { key: `f:${lower(label)}`, label, basis: 'single' } : { key: `i:${lower(its(r) || r.id)}`, label: `ITS ${its(r)}`, basis: 'single' };
}
