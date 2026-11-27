import { isDeepStrictEqual } from 'node:util';
import { NkerpClient } from './nkerp-sync/nkerpClient.js';
import { credentialStatus, MissingCredentials } from './nkerp-sync/credentials.js';
import { norm, familyNo } from './nkerp-sync/util.js';
import { dispatch, json, type HandlerDeps } from './nkerp-sync/handlers.js';
import { photoIndex, photoResponse } from './nkerp-photos.js';
import { createPull, explainTour, removalKey, type HiddenStay, type StoredReservation } from './nkerp-pull.js';
import { expiry, guests, localHistory, prune, read, removals, rooms, stayDates, transaction, write } from './accommodation-store.js';
import { normalizeRules } from '../src/services/allocationRules.js';
import { generateSaifeeBurhani114Rooms, generateBadriRooms, reconcileOfficialSaifeeBurhaniRooms, pruneLegacyBadriRooms, deduplicateRooms } from '../src/services/storage.js';
import type { Room } from '../src/types/index.js';
import { ApprovalError, approvalClient, approveTour, createApprovalRefresh, records as approvalRecords, saveEdit, saveReview,
  settings as approvalSettings, snapshot as approvalSnapshot } from './nkerp-approvals.js';
import { normalizeApprovalSettings } from '../src/services/approvalPlanner.js';

interface RecordChange {
  id:string;
  before:Record<string,unknown> | null;
  after:Record<string,unknown> | null;
}
class SaveConflict extends Error {}
class InvalidChanges extends Error {}
function saveChanges(input: unknown) {
  const { collection, changes } = (input ?? {}) as {collection:'rooms'|'reservations'; changes:RecordChange[]};
  if (!['rooms','reservations'].includes(collection) || !Array.isArray(changes) ||
      changes.some(c => !c || typeof c.id !== 'string' || ![c.before,c.after].every(x => x === null || (x && typeof x === 'object' && !Array.isArray(x))))) {
    throw new InvalidChanges('Invalid changes.');
  }
  return transaction(() => {
      const current = new Map(read<(StoredReservation|Room)[]>(collection,[]).map(r => [r.id,r]));
      const deleted = removals();
      for (const {id,before,after} of changes) {
        const row = current.get(id);
        if (!after) {
          if (!row) continue;
          if (before?.updatedAt && 'updatedAt' in row && before.updatedAt !== row.updatedAt) {
            throw new SaveConflict('A reservation changed before it could be deleted. Reload and try again.');
          }
          current.delete(id);
          if (collection === 'reservations') {
            const stay = row as StoredReservation;
            const until = expiry(stay);
            // Hide only this stay, with the dates NKERP gave it. If NKERP later moves it, it comes back.
            if (Number.isFinite(until)) deleted[removalKey(stay)] = { until, dates: stay.nkerpDates ?? stayDates(stay),
              its: stay.itsId, name: stay.applicantName, tour: stay.tourRefNo,
              arrival: stay.arrivalDateTime || stay.arrivalDate, departure: stay.departureDateTime || stay.departureDate,
              deletedAt: new Date().toISOString() };
          }
          continue;
        }
        if (!row && before) throw new SaveConflict('A record was removed before it could be saved.');
        if (row && !before && !isDeepStrictEqual(row,after)) throw new SaveConflict('A record with that ID already exists.');
        const existing = row as unknown as Record<string,unknown> | undefined;
        const next = {...row};
        for (const [key,value] of Object.entries(after)) {
          if (['id','localFields','nkerpBaseline','arrivalTravel','departureTravel','createdAt','updatedAt','__proto__','constructor','prototype'].includes(key)) continue;
          if (existing && !isDeepStrictEqual(existing[key] ?? null,before?.[key] ?? null) &&
              !isDeepStrictEqual(existing[key] ?? null,value)) throw new SaveConflict('This record changed. Reload the latest values and retry.');
          Object.assign(next,{[key]:value === null ? undefined : value});
        }
        if (collection === 'reservations') {
          const stay = next as StoredReservation;
          if ('building' in after || 'roomNumber' in after) stay.allocationObservedOnly = false;
          stay.localFields = [...new Set([...(stay.localFields || []), ...Object.keys(after).filter(k=>k !== 'id')])];
          stay.updatedAt = new Date().toISOString();
          stay.createdAt ||= stay.updatedAt;
          if (expiry(stay) <= Date.now()) throw new SaveConflict('This stay has passed the three-day retention window.');
          if (!stay.itsId || !stay.tourRefNo) {
            if (typeof stay.itsId !== 'string' || typeof stay.tourRefNo !== 'string') throw new Error('Invalid reservation identity.');
          }
          delete deleted[removalKey(stay)];
        }
        current.set(id,{...next,id} as StoredReservation|Room);
      }
      const list = [...current.values()];
      const saved = collection === 'rooms' ? deduplicateRooms(list as Room[]) : list;
      write(collection,saved);
      if (collection === 'reservations') write('removed-stays',deleted);
      return saved;
    });
}

export function accommodationApi(onChange: () => void = () => {}) {
  const invalidate = () => {
    write('revision', read('revision', 0) + 1);
    onChange();
  };
  const pull = createPull(invalidate);
  const approvals = createApprovalRefresh();
  const approvalState = () => ({ snapshot: approvalSnapshot(), records: approvalRecords(), settings: approvalSettings(),
    refresh: { ...approvals.status } });
  const deps: HandlerDeps = {
    credentials: credentialStatus,
    readHistory: localHistory.read,
    depsFactory: (apply,progress,signal) => ({
      nkerp: new NkerpClient({ allowWrite: apply, signal }),
      readSheet: async () => (guests() as StoredReservation[]).filter(r => !r.allocationObservedOnly).map((r,i) => ({
        row: i+1, its: norm(r.itsId), name:r.applicantName, family:familyNo(r.family), ref:norm(r.tourRefNo),
        building:norm(r.building), room:norm(r.roomNumber), arrival:r.arrivalDate || null, arrival_text:r.rawArrivalStr || r.arrivalDate,
      })),
      history: localHistory, progress, signal, concurrency:6,
    }),
  };

  async function tick() {
    if (transaction(() => prune())) invalidate();
    if (process.env.NAJAF_AUTO_PULL !== 'false') {
      // The approval queues refresh every 15 minutes alongside the minute pull.
      await Promise.all([refresh().catch(() => {}),
        approvals.due() ? approvals.refresh().then(invalidate, () => {}) : Promise.resolve()]);
    }
  }

  async function refresh() {
    const result = await pull.pull();
    write('last-pull', pull.status.lastSyncedAt);
    return result;
  }

  async function fetch(req: Request, hosted = false, waitUntil?: HandlerDeps['waitUntil']): Promise<Response> {
    const route = new URL(req.url).pathname;
    const sync = /^\/api\/nkerp-sync\/([a-z-]+)\/?$/.exec(route);
    if (sync) return dispatch(sync[1], req, {...deps,waitUntil});
    if (req.method === 'GET') {
      if (route === '/api/status') return json({
        status:'ok', liveBackend:true, reservationsCount:guests().length, roomsCount:rooms().length,
        revision:read('revision',0), events:!hosted, hiddenStays:read<HiddenStay[]>('hidden-stays',[]).length,
        pull:{ ...pull.status, lastSyncedAt:pull.status.lastSyncedAt ?? read('last-pull',null) },
      });
      if (route === '/api/reservations') return json(guests());
      if (route === '/api/rooms') return json(rooms());
      if (route === '/api/photos') return json(photoIndex());
      const photo = /^\/api\/photos\/([0-9A-Za-z_-]+)$/.exec(route);
      if (photo) return photoResponse(photo[1]);
      if (route === '/api/settings') return json(read('settings',{}));
      if (route === '/api/approvals') return json(approvalState());
      // Stays NKERP still lists that the app hides because they were deleted here.
      if (route === '/api/hidden-stays') return json(read<HiddenStay[]>('hidden-stays',[]));
      if (route === '/api/nkerp/tour') {
        const ref = new URL(req.url).searchParams.get('ref') || '';
        if (!ref.trim()) return json({error:'Add ?ref=<tour reference>.'},400);
        try { return json(await explainTour(ref)); }
        catch (err) { return json({error:err instanceof Error ? err.message : 'NKERP read failed.'}, err instanceof MissingCredentials ? 503 : 502); }
      }
    }
    if (req.method === 'POST') {
      if (route === '/api/nkerp/pull') {
        try { return json(await refresh()); }
        catch (err) { return json({error:pull.status.error}, err instanceof MissingCredentials ? 503 : 502); }
      }
      if (route.startsWith('/api/approvals/')) {
        const action = route.slice('/api/approvals/'.length);
        const body = await req.json().catch(() => ({})) as Record<string, any>;
        try {
          if (action === 'refresh') {
            await approvals.refresh();
            invalidate();
            return json(approvalState());
          }
          if (action === 'edit') { saveEdit(body as never); invalidate(); return json(approvalState()); }
          if (action === 'review') { saveReview(body as never); invalidate(); return json(approvalState()); }
          if (action === 'settings') {
            const saved = {...read('settings',{}), approvalSettings: normalizeApprovalSettings(body)};
            write('settings', saved);
            invalidate();
            return json(approvalState());
          }
          if (action === 'approve') {
            if (body.confirm !== true) return json({error:'Confirm the approval first.'},400);
            const record = await approveTour(approvalClient(true), body as never);
            invalidate();
            return json({ record, ...approvalState() });
          }
        } catch (err) {
          if (err instanceof ApprovalError) return json({error:err.message}, err.status);
          if (err instanceof MissingCredentials) return json({error:err.message}, 503);
          return json({error: err instanceof Error ? err.message : 'NKERP approval request failed.'}, 502);
        }
        return json({error:'API route unavailable.'},404);
      }
      if (route === '/api/changes') {
        try {
          const output = saveChanges(await req.json());
          invalidate();
          return json(output);
        } catch (err) {
          if (err instanceof InvalidChanges || err instanceof SyntaxError) return json({error:err.message},400);
          if (err instanceof SaveConflict) return json({error:err.message},409);
          console.error('Could not save app changes');
          return json({error:'Changes could not be saved to the app database.'},500);
        }
      }
      if (route === '/api/hidden-stays/restore') {
        const { keys } = await req.json().catch(() => ({})) as { keys?: unknown };
        if (!Array.isArray(keys) || !keys.length || keys.some(k => typeof k !== 'string')) return json({error:'Choose the stays to restore.'},400);
        const restored = transaction(() => {
          const deleted = removals();
          const wanted = new Set(keys as string[]);
          let count = 0;
          for (const key of wanted) if (key in deleted) { delete deleted[key]; count++; }
          write('removed-stays', deleted);
          write('hidden-stays', read<HiddenStay[]>('hidden-stays',[]).filter(h => !wanted.has(h.key)));
          return count;
        });
        invalidate();
        // The next pull adds them back; start one now rather than waiting for the minute timer.
        const pulling = refresh().catch(() => {});
        if (waitUntil) waitUntil(pulling); else await pulling;
        return json({restored});
      }
      if (route === '/api/rooms/reset') {
        const fresh = reconcileOfficialSaifeeBurhaniRooms(pruneLegacyBadriRooms(deduplicateRooms([
          ...generateSaifeeBurhani114Rooms(), ...generateBadriRooms(),
        ])));
        write('rooms',fresh);
        invalidate();
        return json({rooms:fresh});
      }
      if (route === '/api/settings') {
        const { categories, adminPin, plannerRules } = await req.json() as {categories?:unknown[]; adminPin?:string; plannerRules?:unknown};
        const saved = {...read('settings',{}),
          ...(Array.isArray(categories) ? {categories:categories.filter(c=>typeof c==='string')} : {}),
          ...(typeof adminPin === 'string' && adminPin.length >= 4 ? {adminPin} : {}),
          // AI Planner rules and chat-box instructions, shared by everyone using the app.
          ...(plannerRules && typeof plannerRules === 'object' && JSON.stringify(plannerRules).length < 100_000 ? {plannerRules:normalizeRules(plannerRules)} : {}),
        };
        write('settings',saved);
        invalidate();
        return json({success:true,config:saved});
      }
    }
    return json({error:'API route unavailable.'},404);
  }
  return { fetch, tick };
}
