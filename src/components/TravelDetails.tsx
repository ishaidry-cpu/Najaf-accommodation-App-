import React from 'react';
import type { TravelLeg } from '../types';

/** `28 Nov` for a `YYYY-MM-DD` date (UTC, so the day never shifts). */
export const stayDay = (v?: string) => {
  const d = String(v || '').slice(0, 10);
  const date = new Date(d + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** The travel legs NKERP holds for that day of the stay (arrival legs on the arrival date, departure legs on the departure date). */
export const travelLegsOn = (legs: TravelLeg[] | undefined, date: string | undefined) =>
  legs?.filter((leg) => leg.serviceDate === String(date || '').slice(0, 10)) ?? [];

/** Travel note under a date: "SBVN to KARBALA, departure 08:00". Plain secondary text, one or two lines. */
export function TravelDetails({ legs, date, direction, flush }: {
  legs?: TravelLeg[];
  date: string;
  direction: 'arrival' | 'departure';
  /** No side padding (where it sits under plain text rather than under an input). */
  flush?: boolean;
}) {
  const visible = travelLegsOn(legs, date);
  if (!visible.length) return null;
  const incoming = direction === 'arrival';
  return (
    <ul className={`mt-0.5 space-y-0.5 text-xs leading-snug text-stone-600 ${flush ? '' : 'px-1.5'}`}>
      {visible.map((leg) => {
        const kind = leg.kind === 'subvenue' ? 'SBVN' : leg.kind === 'flight' ? 'Flight' : leg.kind === 'land' ? 'Land' : '';
        const route = leg.location && `${incoming ? 'from' : 'to'} ${leg.location}`;
        const time = leg.localTime?.slice(11, 16);
        const eventDate = leg.localTime?.slice(0, 10);
        const event = leg.kind === 'flight' ? (incoming ? 'lands' : 'takes off') : (incoming ? 'arrival' : 'departure');
        return (
          <li key={JSON.stringify(leg)} className="break-words">
            <span className="text-stone-700">{[kind, leg.flightCode, route].filter(Boolean).join(' ')}</span>
            {time && (
              <span title="Baghdad time" className="tabular-nums">
                , {event} {eventDate !== leg.serviceDate && `${stayDay(eventDate)} `}{time}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
