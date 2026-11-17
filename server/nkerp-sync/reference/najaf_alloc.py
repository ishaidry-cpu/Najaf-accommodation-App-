"""Najaf Accommodation Sync: Sheet room allotments -> NKERP (allocate, reallocate, deallocate), API only.

The Sheet is the latest word; NKERP is brought in line with it. Dry run by default. --apply runs, in order:
  1. deallocate: people an earlier run saw in the Sheet with a room, whose row is now blank or gone, and whom
     NKERP still has in that room (nights from today on only);
  2. reallocate: people NKERP has in a different building/room than the Sheet gives (nights from today on);
  3. allocate:   people NKERP still lists as unallocated (Manage Room Allocation).
Each room group / person is one save, confirmed by a fresh read, never retried. An applied run appends what it
saw and did to the Sheet's 'Sync History' tab, which is also the memory of earlier runs. Nothing else in the
Sheet is edited, and no emails go out (EmailOption 0). Python 3.9+, standard library plus google-auth.
"""
import argparse
import json
import re
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from http.cookiejar import Cookie, CookieJar
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPCookieProcessor, Request, build_opener
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import credentials  # noqa: E402
import history  # noqa: E402

BASE = 'https://to.najafkarbala.com/NKERPApi/'
LOCAL = ZoneInfo('Asia/Baghdad')
ROLE, VENUE, NAJAF = 74, 2, 3                      # Tour and Accomodation Admin, IRAQ, NAJAF
SHEET_ID = '1kOWtRpUF9yeN52MmaiWMW7q8ddDEsIyYrvZgv0_t0uw'
SHEET_TAB = 'Zaereen Lodging & Room Allotment Grid'
SEARCH = 'api/property/getRoomallocationSearchResult'           # Manage Room Allocation: unallocated people
BUILDINGS = 'api/Property/getPropertyDetailListForAllocation'
ROOMS = 'api/Property/getRoomsDetailsforAllocation'
CURRENT = 'api/Property/getRoomDetailsforDeallocation'          # Manage Room Deallocation search: who is where
PROPERTIES = f'api/dropdown/getPropertybySubvenueId/{NAJAF}'     # property names -> ids (Najaf)
SAVE = 'api/Property/saveRoomallocationApplicantsDetails'       # Assign Room
REALLOC = 'api/Property/saveRoomReallocationApplicantsDetails'  # Manage Room Reallocation save
DEALLOC = 'api/Property/DeallocateApplicants'                   # Manage Room Deallocation save
READS, WRITES = (SEARCH, BUILDINGS, ROOMS, CURRENT, PROPERTIES), (SAVE, REALLOC, DEALLOC)
LOOKBACK_DAYS = 21          # stays that arrived up to this long ago can still be reallocated / deallocated
MAX_DEALLOC = 20            # more people than this to deallocate in one run -> hold them all and report
HEADERS = {'its': ['ITS'], 'name': ['NAME'], 'family': ['FAMILY'], 'ref': ['TOUR ID'], 'building': ['BUILDING'],
           'room': ['ROOM ALLOTTMENT', 'ROOM ALLOTMENT'], 'arrival': ['ARRIVAL']}
REQUIRED = ('its', 'family', 'ref', 'building', 'room', 'arrival')
DATE_FORMATS = ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%d.%m.%Y', '%Y/%m/%d', '%d-%b-%Y', '%d %b %Y', '%d-%B-%Y',
                '%d %B %Y', '%b %d, %Y', '%B %d, %Y')


class Rejected(RuntimeError):
    """NKERP answered and refused the request (HTTP error status or IsError)."""


def norm(s):
    return re.sub(r'\s+', ' ', str(s if s is not None else '')).strip().upper()


def day(s):
    return str(s)[:10]


def place(b, r):
    return f'{b.title()} {r}'.strip() if b or r else ''


def family_no(s):
    """'F-7', 'F7', 'f - 07', '7' -> 'F-7'; anything else -> ''."""
    m = re.fullmatch(r'F?\s*-?\s*0*(\d+)', norm(s))
    return f'F-{int(m.group(1))}' if m else ''


def parse_arrival(formatted, raw=None):
    """ISO date from the Sheet's ARRIVAL cell, or None. A real date cell arrives as a serial number in `raw`;
    a typed text date is parsed (day first: 26-11-2026 is 26 Nov)."""
    if isinstance(raw, (int, float)) and not isinstance(raw, bool) and raw > 0:
        return (date(1899, 12, 30) + timedelta(days=int(raw))).isoformat()
    s = str(formatted or '').strip()
    if not s:
        return None
    s = re.split(r'[T ]\d{1,2}:\d{2}', s)[0].strip()      # drop a time part
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


# ---------------------------------------------------------------- Google Sheet
def google_token():
    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request as GReq
    except ImportError:
        raise SystemExit('google-auth missing: pip install --break-system-packages google-auth requests '
                         '(on a Mac: pip3 install google-auth requests)')
    creds = service_account.Credentials.from_service_account_info(
        credentials.google_key(), scopes=['https://www.googleapis.com/auth/spreadsheets'])
    creds.refresh(GReq())
    return creds.token


def _sheet_values(token, render):
    url = (f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/'
           f"{quote(chr(39) + SHEET_TAB.replace(chr(39), chr(39) * 2) + chr(39), safe='')}?valueRenderOption={render}"
           + ('&dateTimeRenderOption=SERIAL_NUMBER' if render == 'UNFORMATTED_VALUE' else ''))
    for attempt in range(3):
        try:
            with build_opener().open(Request(url, headers={'Authorization': 'Bearer ' + token}), timeout=120) as r:
                return json.load(r).get('values', [])
        except (URLError, ConnectionError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


def read_sheet(token=None):
    token = token or google_token()
    shown = _sheet_values(token, 'FORMATTED_VALUE')        # the whole tab, no row cap
    raw = _sheet_values(token, 'UNFORMATTED_VALUE')         # only for real date cells in ARRIVAL
    return parse_sheet(shown, raw)


def parse_sheet(shown, raw):
    if not shown:
        raise SystemExit('Sheet tab is empty or unreadable')
    head = [norm(h) for h in shown[0]]
    col = {}
    for key, names in HEADERS.items():
        col[key] = next((head.index(n) for n in names if n in head), None)
    missing = [HEADERS[k][0] for k in REQUIRED if col[k] is None]
    if missing:
        raise SystemExit(f'Sheet header changed; missing {missing}')
    rows = []
    for n, vals in enumerate(shown[1:], start=2):
        rvals = raw[n - 1] if n - 1 < len(raw) else []
        cell = lambda k: (vals[col[k]] if col[k] is not None and col[k] < len(vals) else '')
        rcell = rvals[col['arrival']] if col['arrival'] < len(rvals) else None
        text_arrival = str(cell('arrival')).strip()
        rows.append({'row': n, 'its': str(cell('its')).strip(), 'name': str(cell('name')).strip(),
                     'family': family_no(cell('family')), 'ref': norm(cell('ref')),
                     'building': norm(cell('building')), 'room': norm(cell('room')),
                     'arrival': parse_arrival(text_arrival, rcell), 'arrival_text': text_arrival})
    return rows


# ---------------------------------------------------------------- NKERP client
class Client:
    def __init__(self, allow_write=False):
        self.allow_write = allow_write
        self._reset()

    def _reset(self):
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))
        self.ready = False

    def _req(self, path, body=None):
        req = Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                      headers={'Accept': 'application/json', 'Content-Type': 'application/json',
                               'Origin': 'https://to.najafkarbala.com', 'Referer': 'https://to.najafkarbala.com/'})
        try:
            with self.opener.open(req, timeout=90) as res:
                obj = json.load(res)
        except HTTPError as e:
            raise Rejected(f'NKERP HTTP {e.code} on {path}') from None
        if not isinstance(obj, dict) or obj.get('IsError'):
            msg = obj.get('ReturnMessage') if isinstance(obj, dict) else None
            raise Rejected(f'NKERP refused {path}: {msg}')
        return obj

    def login(self):
        if self.ready:
            return
        login_id, password = credentials.nkerp_login()
        r = self._req('api/accounts/Login', {'LocalUTCTime': datetime.now(timezone.utc).isoformat(),
                                             'LoginId': login_id, 'Password': password})
        if not (r.get('ReturnStatus') and r.get('IsAuthenicated')) or str(ROLE) not in str(r.get('Role', '')).split(','):
            raise RuntimeError('Login failed or Tour and Accomodation Admin role missing')
        self._req(f'api/user/GetSectionIdByGroupId/{ROLE}')
        for k, v in (('GroupId', ROLE), ('UserId', r['UserId'])):
            self.cookies.set_cookie(Cookie(0, k, str(v), None, False, 'to.najafkarbala.com', False, False, '/',
                                           True, True, None, True, None, None, {}, False))
        self.ready = True

    def read(self, path, body):
        """POST (or GET when body is None) to a listed read endpoint. Reads are retried; writes never are."""
        if path not in READS:
            raise ValueError('not a read endpoint')
        relogged = False
        for attempt in range(3):
            self.login()
            try:
                return self._req(path, body)
            except Rejected as e:
                if 'HTTP 401' in str(e) and not relogged:   # expired session: log in again once
                    self._reset()
                    relogged = True
                    continue
                raise
            except (URLError, ConnectionError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(3 * (attempt + 1))
        raise RuntimeError(f'NKERP read failed: {path}')

    def write(self, path, body):
        if path not in WRITES:
            raise ValueError('not a write endpoint')
        if not self.allow_write:
            raise RuntimeError('write disabled (dry run)')
        self.login()
        return self._req(path, body)

    def _paged(self, path, body, list_key, key):
        out, page, seen = [], 1, set()
        while True:
            r = self.read(path, dict(body, currentPage=page))
            chunk = r.get(list_key) or []
            total = int(r.get('TotalRows') or 0)
            new = 0
            for a in chunk:
                a.pop('ImageUrl', None)
                k = key(a)
                if k not in seen:
                    seen.add(k)
                    out.append(a)
                    new += 1
            if len(seen) >= total:
                return out
            if not chunk:
                raise RuntimeError(f'NKERP list stopped at {len(seen)} of {total} rows; not planning on a partial list')
            if not new:
                raise RuntimeError('NKERP repeated a page of a list; not planning on a partial list')
            page += 1

    def pending(self):
        """Every Najaf applicant that still has unallocated dates (the Manage Room Allocation list)."""
        body = {'ArrivalFromDate': None, 'ArrivalToDate': None, 'Category': '', 'DepartureFromDate': None,
                'DepartureToDate': None, 'FamilyID': '', 'GenderID': '', 'HOFID': None, 'RazaCode': None, 'Idara': '',
                'IsRoomAllocationRole': False, 'OfficeName': '', 'PackageId': '', 'ItsID': '', 'PropertyId': None,
                'SubVenueID': str(NAJAF), 'TimeZone': 3, 'TourRefenceNO': '', 'VenueID': str(VENUE), 'isDST': False,
                'itemsPerPage': 200, 'maxSize': 10, 'reverse': True, 'sortBy': 'ModifiedOn'}
        return self._paged(SEARCH, body, 'lstAllocationApllicationDetails', lambda a: (a['ApplicantinTourId'], a['TourID']))

    def current(self, ref):
        """One tour's allocated Najaf room-nights (Manage Room Deallocation search by Tour Reference No.)."""
        body = {'FamilyID': '', 'FloorNo': '', 'OccupiedDateFrom': None, 'OccupiedDateTo': None, 'PropertyId': [],
                'RoomNo': '', 'RoomTypeId': '', 'SubVenueID': str(NAJAF), 'TimeZone': 3, 'TourRefenceNO': [ref],
                'VenueID': str(VENUE), 'itemsPerPage': 500, 'maxSize': 10, 'reverse': False, 'sortBy': 'OccupiedDate'}
        return self._paged(CURRENT, body, 'lstAllocationDetails',
                           lambda r: r.get('Id') or (r.get('RoomDetailId'), r.get('OccupiedDate')))

    def properties(self):
        r = self.read(PROPERTIES, None)
        return {norm(p['Text']): p['Value'] for p in r.get('Properties') or []}

    def buildings(self, tour_ids, dates):
        r = self.read(BUILDINGS, {'IsGroundfloor': None, 'IsHouseKeepingAvailable': None, 'IsBasement': None,
                                  'IsLift': None, 'IsRented': None, 'PersonTypeId': '', 'SubVenueId': NAJAF,
                                  'PropertyGradeId': 0, 'VenueId': VENUE, 'maxSize': 10, 'reverse': False,
                                  'sortBy': 'ModifiedOn', 'PropertyTypeId': 0, 'TourIds': tour_ids, 'PropertyName': '',
                                  'RoomTypeId': 0, 'AssignedDateList': dates, 'RentPeriodStartDate': dates[0],
                                  'RentPeriodEndDate': dates[-1], 'currentPage': 1, 'itemsPerPage': 100})
        rows = r.get('PropertyDetailListView') or []
        if int(r.get('TotalRows') or 0) > len(rows):
            raise RuntimeError('NKERP building list has more than one page')
        return {norm(p['PropertyName']): p['Id'] for p in rows}

    def rooms(self, property_id, tour_ids, dates):
        """All rooms of a building (Show Occupied on), with their existing allocations on these dates."""
        r = self.read(ROOMS, {'AssignedDateList': dates, 'IsBasement': None, 'IsGroundfloor': None,
                              'IsHouseKeepingAvailable': None, 'IsLift': None, 'IsRented': None,
                              'IsRoomAllocationRole': False, 'PersonTypeId': '', 'PropertyGradeId': 0,
                              'PropertyId': property_id, 'PropertyTypeId': 0, 'RentPeriodEndDate': dates[-1],
                              'RentPeriodStartDate': dates[0], 'RoomTypeId': 0, 'ShowOccupied': True,
                              'SubVenueId': NAJAF, 'TourIds': tour_ids, 'VenueId': VENUE, 'currentPage': 1,
                              'itemsPerPage': 500, 'maxSize': 10, 'reverse': False, 'sortBy': 'ModifiedOn'})
        rows = r.get('lstRoomDetails') or []
        if int(r.get('TotalRows') or 0) > len(rows):
            raise RuntimeError('NKERP room list has more than one page')
        return {norm(x['RoomNumber']): x for x in rows}

    def save(self, payload):
        return self.write(SAVE, payload)

    def reallocate(self, payload):
        return self.write(REALLOC, payload)

    def deallocate(self, payload):
        return self.write(DEALLOC, payload)


# ---------------------------------------------------------------- who goes where (pure)
def sheet_index(rows):
    """One tour's Sheet rows -> ITS rooms, duplicate ITS, and family rooms (rows with ITS + building + room)."""
    usable = [r for r in rows if r['its'] and r['room'] and r['building']]
    its_room, dupes = {}, set()
    for r in usable:
        k = norm(r['its'])
        if k in its_room and its_room[k] != (r['building'], r['room']):
            dupes.add(k)
        its_room.setdefault(k, (r['building'], r['room']))
    for k in dupes:
        its_room.pop(k)
    fam_rooms = defaultdict(set)
    for r in usable:
        if r['family']:
            fam_rooms[r['family']].add((r['building'], r['room']))
    return {'its_room': its_room, 'dupes': dupes, 'fam_rooms': fam_rooms}


def resolve(ix, its, fam):
    """The Sheet's room for one NKERP person: ('room', (building, room), how), ('dupe' | 'split', None, why),
    or ('none', None, '') when the Sheet gives no room."""
    if its in ix['dupes']:
        return 'dupe', None, 'duplicate ITS with different rooms'
    if its in ix['its_room']:
        return 'room', ix['its_room'][its], 'ITS'
    rooms = ix['fam_rooms'].get(fam, ()) if fam else ()
    if len(rooms) == 1:
        return 'room', next(iter(rooms)), 'family ' + fam
    if len(rooms) > 1:
        return 'split', None, 'family split across rooms'
    return 'none', None, ''


def stay_dates(app, arrival):
    """Unallocated Najaf dates of the stay that arrives on the Sheet's arrival day."""
    all_stays = app.get('TourIternaryDates') or []
    stays = [s for s in all_stays if day(s['ArrivalDate']) == arrival]
    if not stays and len(all_stays) == 1:
        stays = all_stays            # one Najaf stay only: NKERP's dates win over the Sheet's arrival
    if len(stays) != 1:
        return None
    lo, hi = day(stays[0]['ArrivalDate']), day(stays[0]['DepartureDate'])
    return [d for d in app.get('lstSubVenueDates') or []
            if lo <= day(d['ArrivalDate']) <= hi and not d.get('isPreviousAssigned') and not d.get('isFull')]


def plan(sheet, apps, today):
    """Allocation: match Sheet rows to pending NKERP applicants. Returns (assignments, notes, skipped counts)."""
    notes, skipped = defaultdict(list), defaultdict(int)
    rows = []
    for r in sheet:
        if not r['ref']:
            continue
        if r['arrival'] is None:
            if r['arrival_text']:
                notes['unreadable ARRIVAL date in the Sheet (row skipped)'].append(
                    f"row {r['row']} {r['ref']} '{r['arrival_text']}'")
            else:
                skipped['no ARRIVAL date'] += 1
            continue
        if r['arrival'] >= today:
            rows.append(r)
    by_ref = defaultdict(list)
    for a in apps:
        by_ref[norm(a['TourRefenceNO'])].append(a)
    groups = defaultdict(list)
    for r in rows:
        groups[r['arrival'], r['ref']].append(r)
    out = []
    for (arrival, ref), rs in sorted(groups.items()):
        for r in rs:
            if not r['its']:
                skipped['no ITS in the Sheet'] += 1
            elif not (r['room'] and r['building']):
                skipped['no building/room yet in the Sheet'] += 1
        ix = sheet_index(rs)
        if not ix['its_room'] and not ix['dupes']:
            continue
        for k in sorted(ix['dupes']):
            notes['duplicate ITS with different rooms (skipped)'].append(f'{ref} ITS {k}')
        cands = by_ref.get(ref, [])
        if not cands:
            skipped['tours already fully allocated in NKERP'] += 1
            continue
        matched = set()
        for a in cands:
            its = norm(a.get('ITSId'))
            kind, target, how = resolve(ix, its, family_no(a.get('FamilyName')))
            if kind == 'split':
                notes['family split across rooms in the Sheet and person not listed by ITS (skipped)'].append(
                    f'{ref} {family_no(a.get("FamilyName"))} {a["ApplicantName"].strip()}')
            if kind != 'room':
                continue
            dates = stay_dates(a, arrival)
            if dates is None:
                notes['arrival date differs from NKERP stay'].append(f'{ref} {a["ApplicantName"].strip()} (Sheet {arrival})')
                continue
            if not dates:
                continue
            nk = day(dates[0]['ArrivalDate'])
            if not any(day(s['ArrivalDate']) == arrival for s in a.get('TourIternaryDates') or []):
                how += f' (Sheet arrival {arrival}, NKERP {nk} used)'
            matched.add(its)
            out.append({'arrival': arrival, 'ref': ref, 'building': target[0], 'room': target[1], 'how': how,
                        'app': a, 'dates': dates})
        cand_its = {norm(a.get('ITSId')) for a in cands}
        for k in ix['its_room']:
            if k not in matched and k not in cand_its:
                skipped['Sheet people already allocated in NKERP'] += 1
    return out, notes, skipped


def people_on_tour(rows, ref):
    """A tour's NKERP room-nights -> {ITS: person with nights [{day, building, room, row, entry}]}."""
    out = {}
    for r in rows:
        if r.get('IsActive') is False or not r.get('OccupiedDate'):
            continue
        for x in r.get('RoomAllocatedDates_Current') or []:
            if x.get('IsActive') is False:
                continue
            if x.get('TourReferenceNo') and norm(x['TourReferenceNo']) != ref:
                continue                      # someone from another tour sharing the room that night
            its = norm(x.get('AppicantITSId'))
            if not its:
                continue
            p = out.setdefault(its, {'its': its, 'aid': x.get('ApplicantId'), 'ref': ref, 'tour_id': x.get('TourId'),
                                     'name': str(x.get('ApplicantName') or '').strip(),
                                     'family': family_no(x.get('Family')), 'nights': []})
            p['nights'].append({'day': day(r['OccupiedDate']), 'building': norm(r.get('PropertyName')),
                                'room': norm(r.get('RoomNo')), 'row': r, 'entry': x})
    for p in out.values():
        p['nights'].sort(key=lambda n: n['day'])
    return out


def plan_sync(sheet, current, apps, mem, today):
    """Reallocations, deallocations and the Sheet state for history.
    current: {TOUR ID: {ITS: person}} from NKERP; mem: history.memory(); apps: the unallocated list."""
    notes = defaultdict(list)
    by_ref = defaultdict(list)
    for r in sheet:
        if r['ref'] and r['its']:
            by_ref[r['ref']].append(r)
    idx = {ref: sheet_index(rs) for ref, rs in by_ref.items()}
    empty = sheet_index([])
    arrival = {(r['ref'], norm(r['its'])): r['arrival'] for r in sheet if r['ref'] and r['its'] and r['arrival']}
    moves, removals, cleared, state = [], [], [], {}

    def remember(ref, its, name, target, how, first_day):
        state[ref, its] = {'building': target[0], 'room': target[1], 'how': how, 'name': name,
                           'arrival': arrival.get((ref, its)) or first_day or ''}

    for ref, people in sorted(current.items()):
        ix = idx.get(ref, empty)
        for its, p in sorted(people.items()):
            kind, target, how = resolve(ix, its, p['family'])
            if kind != 'room':
                continue
            remember(ref, its, p['name'], target, how, p['nights'][0]['day'] if p['nights'] else '')
            wrong = [n for n in p['nights'] if n['day'] >= today and (n['building'], n['room']) != target]
            if wrong:
                moves.append({'ref': ref, 'person': p, 'building': target[0], 'room': target[1], 'how': how,
                              'nights': wrong, 'from': sorted({place(n['building'], n['room']) for n in wrong})})
    for a in apps:
        ref, its = norm(a['TourRefenceNO']), norm(a.get('ITSId'))
        if ref in idx and (ref, its) not in state:
            kind, target, how = resolve(idx[ref], its, family_no(a.get('FamilyName')))
            if kind == 'room':
                first = (a.get('TourIternaryDates') or [{}])[0].get('ArrivalDate', '')
                remember(ref, its, a['ApplicantName'].strip(), target, how, day(first) if first else '')
    for (ref, its), m in sorted(mem.items()):
        if not m['room']:
            continue
        p = current.get(ref, {}).get(its)
        kind, target, why = resolve(idx.get(ref, empty), its, p['family'] if p else '')
        if kind == 'room':
            continue                          # still has a room in the Sheet; reallocation handles any change
        if kind != 'none':
            notes['Sheet unclear for a previously synced person (left alone)'].append(f'{ref} ITS {its}: {why}')
            continue
        was = (m['building'], m['room'])
        future = [n for n in (p['nights'] if p else []) if n['day'] >= today]
        mine = [n for n in future if (n['building'], n['room']) == was]
        base = {'ref': ref, 'its': its, 'name': (p or {}).get('name') or m['name'], 'arrival': m['arrival'],
                'was': was}
        if not future:
            cleared.append(dict(base, details='Sheet cleared; NKERP has no Najaf nights from today'))
        elif not mine:
            here = ', '.join(sorted({place(n['building'], n['room']) for n in future}))
            cleared.append(dict(base, details=f'Sheet cleared; NKERP has them in {here}, not the last synced room; left alone'))
            notes['Sheet cleared but NKERP room differs from last sync (left alone)'].append(
                f'{ref} {base["name"]} (ITS {its}): NKERP {here}, last synced {place(*was)}')
        else:
            if len(mine) < len(future):
                notes['deallocated only the last synced room; other NKERP nights left'].append(
                    f'{ref} {base["name"]} (ITS {its})')
            removals.append(dict(base, person=p, nights=mine))
    return {'moves': moves, 'removals': removals, 'cleared': cleared, 'state': state, 'notes': notes}


# ---------------------------------------------------------------- payloads (mirror the NKERP screens)
def payload(room, items):
    """Assign Room save for one room and the selected applicants (Manage Room Allocation)."""
    per_date = {}
    for it in items:
        a = it['app']
        for d in it['dates']:
            e = per_date.setdefault(d['ArrivalDate'], {
                'RoomDetailId': room['Id'], 'TotalCapacity': room['TotalCapacity'], 'OccupiedDate': d['ArrivalDate'],
                'ApplicantName': a['ApplicantName'], 'RoomAllocatedDates_Current': [], 'AssignedCapacity': 0,
                'IsFull': False, 'RoomAllocationStatus': [], 'VenueId': VENUE, 'SubvenueId': NAJAF})
            e['RoomAllocatedDates_Current'].append({'ApplicantId': a['ApplicantinTourId'], 'ApplicantName': a['ApplicantName'],
                                                    'GenderName': a['GenderName'], 'IsInfant': a['IsInfant']})
            e['AssignedCapacity'] += 0 if a['IsInfant'] else 1
    dates = [per_date[k] for k in sorted(per_date)]
    for e in dates:
        e['RoomAllocationStatus'] = [{'TotalCapacity': e['TotalCapacity'], 'AssignedCapacity': e['AssignedCapacity'],
                                      'RemainingCapacity': e['TotalCapacity'] - e['AssignedCapacity']}]
    status = []
    for it in items:
        a, mine = it['app'], {d['ArrivalDate'] for d in it['dates']}
        full = all(d.get('isPreviousAssigned') or d['ArrivalDate'] in mine for d in a['lstSubVenueDates'])
        status.append({'ApplicantId': a['ApplicantinTourId'], 'IsFullyAssigned': full, 'VenueId': VENUE,
                       'SubvenueId': NAJAF, 'TourID': a['TourID']})
    return {'lstAccomodationRoomAllocatedDates': dates, 'lstApplicantsAllocationStatus': status}


def realloc_payload(room, building, moves):
    """Manage Room Reallocation save: the selected people's nights into one new room. Built exactly as the
    screen's Save handler: AssignedCapacity stays 0, PrevRoomAllocatedDatesId is the old room-night's Id."""
    rno, pname = room['RoomNumber'], room.get('PropertyName') or building.title()
    per_date = {}
    for mv in moves:
        p = mv['person']
        for n in mv['nights']:
            x, occ = n['entry'], n['row']['OccupiedDate']
            e = per_date.get(occ)
            entry = {'ApplicantId': p['aid'], 'AppicantITSId': x.get('AppicantITSId'),
                     'PrevRoomAllocatedDatesId': n['row'].get('Id'), 'ApplicantName': x.get('ApplicantName'),
                     'GenderName': x.get('GenderName'), 'IsInfant': x.get('IsInfant'), 'TourId': x.get('TourId'),
                     'TourReferenceNo': x.get('TourReferenceNo'), 'RoomNumber': rno, 'PropertyName': pname}
            if e is None:
                per_date[occ] = {'RoomDetailId': room['Id'], 'TotalCapacity': room['TotalCapacity'], 'OccupiedDate': occ,
                                 'AssignedCapacity': 0, 'RoomAllocatedDates_Current': [entry],
                                 'RoomAllocatedDates_Prev': [], 'RoomAllocationStatus': [], 'VenueId': VENUE,
                                 'SubvenueId': NAJAF, 'SubVenueName': 'NAJAF', 'PropertyName': pname, 'RoomNumber': rno}
            else:
                e['RoomAllocatedDates_Current'].append(dict(entry, AssignedCapacity=0))
    out = [per_date[k] for k in sorted(per_date, key=day)]
    for e in out:
        e['RoomAllocationStatus'] = [{'TotalCapacity': e['TotalCapacity'], 'AssignedCapacity': 0,
                                      'RemainingCapacity': e['TotalCapacity']}]
    return {'DeallocateList': out, 'EmailOption': 0}


def dealloc_payload(nights):
    """Manage Room Deallocation: each room-night row with only this person ticked (Checkbox true)."""
    out = []
    for n in sorted(nights, key=lambda n: n['day']):
        r = n['row']
        out.append({'Id': r.get('Id'), 'IsFull': r.get('IsFull'), 'OccupiedDate': r.get('OccupiedDate'),
                    'PropertyId': r.get('PropertyId'), 'PropertyName': r.get('PropertyName'),
                    'RoomAllocatedDates_Current': [dict(n['entry'], Checkbox=True)],
                    'RoomDetailId': r.get('RoomDetailId'), 'RoomNo': r.get('RoomNo'), 'RoomTypeId': r.get('RoomTypeId'),
                    'SubvenueId': r.get('SubvenueId'), 'SubvenueName': r.get('SubvenueName'), 'VenueId': r.get('VenueId')})
    return {'DeallocateList': out, 'EmailOption': 0}


# ---------------------------------------------------------------- capacity and readback
def occupancy(room, extra=None):
    """Counted occupancy per day in this room and who is there, plus this dry run's planned guests."""
    used, who = defaultdict(int), defaultdict(set)
    for e in room.get('AccomodationRoomAllocatedDatesNew') or []:
        if e.get('IsActive') is False:
            continue
        cur = [x for x in e.get('RoomAllocatedDates_Current') or [] if x.get('IsActive') is not False]
        used[day(e['OccupiedDate'])] += sum(1 for x in cur if not x.get('IsInfant'))
        who[day(e['OccupiedDate'])] |= {x['ApplicantId'] for x in cur}
    for (d, applicant), infant in (extra or {}).items():
        if applicant not in who[d]:
            used[d] += 0 if infant else 1
            who[d].add(applicant)
    return used, who


def capacity_problems(room, new_per_day, extra=None):
    """new_per_day: [(day, beds needed)] in date order. Over-capacity days, except a checkout/check-in turnover
    on the first day (the room's current guests have their last night there that day)."""
    used, who = occupancy(room, extra)
    days_ = [d for d, _ in new_per_day]
    bad = []
    for i, (d, need) in enumerate(new_per_day):
        if used[d] + need <= room['TotalCapacity']:
            continue
        turnover = i == 0 and len(days_) > 1 and not (who[d] & who[days_[1]])
        if not turnover:
            bad.append(f"{d}: {used[d]} already + {need} new > {room['TotalCapacity']} beds")
    return bad


def alloc_need(body):
    return [(day(e['OccupiedDate']), e['AssignedCapacity']) for e in body['lstAccomodationRoomAllocatedDates']]


def persisted(c, pid, tids, dates, rno, its):
    """(missing (name, day) pairs, how many of the group's (person, day) pairs are present) from a fresh read."""
    fresh = c.rooms(pid, tids, dates).get(rno) or {}
    got = defaultdict(set)
    for e in fresh.get('AccomodationRoomAllocatedDatesNew') or []:
        if e.get('IsActive') is False:
            continue
        for x in e.get('RoomAllocatedDates_Current') or []:
            if x.get('IsActive') is not False:
                got[day(e['OccupiedDate'])].add(x['ApplicantId'])
    want = [(it['app']['ApplicantinTourId'], it['app']['ApplicantName'].strip(), day(d['ArrivalDate']))
            for it in its for d in it['dates']]
    missing = [(n, d) for aid, n, d in want if aid not in got[d]]
    return missing, len(want) - len(missing)


def commit(send, check):
    """One write, never retried, then a fresh read. -> (status, detail); status is 'done', 'refused' (NKERP
    plainly refused and nothing landed) or 'unconfirmed' (stop all further writes)."""
    refused, err = False, None
    try:
        resp = send()
        if isinstance(resp, dict) and resp.get('ReturnStatus') is False:
            err = f"save answered ReturnStatus false: {resp.get('ReturnMessage')}"
    except Rejected as exc:
        refused, err = True, str(exc)
    except Exception as exc:               # timeout / dropped connection: the save may or may not have landed
        err = f'{type(exc).__name__} during save'
    try:
        missing, present = check()
    except Exception as exc:
        return 'unconfirmed', f'{err or "saved"}; readback failed ({exc})'
    if not missing:
        return 'done', (err + ' (but readback confirms every person on every night)') if err else None
    if present == 0 and (refused or (err and 'ReturnStatus false' in err)):
        return 'refused', f'NKERP refused the save: {err}'
    return 'unconfirmed', f'{err or "saved"} but readback is missing {missing[:5]}'


# ---------------------------------------------------------------- run
class Run:
    def __init__(self, c, apply, today, allow_over, limit):
        self.c, self.apply, self.today, self.allow_over, self.limit = c, apply, today, allow_over, limit
        self.report = {'today': today, 'mode': 'apply' if apply else 'dry-run', 'done': [], 'planned': [],
                       'problems': [], 'notes': {}, 'skipped': {}}
        self.hist, self.acted = [], set()
        self.bcache, self.rcache, self.props = {}, {}, None
        self.planned_load = defaultdict(dict)        # dry run: room Id -> {(day, applicant): infant}

    # -- bookkeeping
    def full(self):
        return bool(self.limit) and len(self.report['done']) + len(self.report['planned']) >= self.limit

    def stopped(self):
        return 'stopped' in self.report

    def log(self, action, result, ref, its, name, arrival, sheet=None, before='', after='', nights=(), details=''):
        self.hist.append({'Action': action, 'Result': result, 'Tour ID': ref, 'ITS': its, 'Name': name,
                          'Arrival': arrival or '', 'Sheet Building': (sheet or ('', ''))[0].title(),
                          'Sheet Room': (sheet or ('', ''))[1], 'NKERP Before': before, 'NKERP After': after,
                          'Nights': f'{nights[0]} to {nights[-1]}' if nights else '', 'Details': details or ''})
        if action in ('ALLOCATE', 'REALLOCATE'):
            self.acted.add((ref, its))

    def outcome(self, entry, status, detail, rows):
        """Record one write's outcome in the report; rows: history rows to log as (action, kwargs)."""
        if status == 'done':
            if detail:
                entry['warning'] = detail
            self.report['done'].append(entry)
        else:
            reason = detail + ('' if status == 'refused' else '. Check this in NKERP before running again.')
            self.report['problems'].append({'action': entry['action'], 'group': entry['group'],
                                            'people': entry['people'], 'reason': reason})
            if status == 'unconfirmed':
                self.report['stopped'] = f'unconfirmed {entry["action"]} ({entry["group"]}); stopped further saves'
        for action, kw in rows:
            self.log(action, status, details=None if status == 'done' else detail, **kw)

    def problem(self, action, group, people, reason, rows=()):
        self.report['problems'].append({'action': action, 'group': group, 'people': people, 'reason': reason})
        for act, kw in rows:
            self.log(act, 'held', details=reason, **kw)

    def room(self, pid, tids, dates, rno):
        key = (pid, tuple(tids), tuple(dates))
        if key not in self.rcache:
            self.rcache[key] = self.c.rooms(pid, list(tids), list(dates))
        room = self.rcache[key].get(rno)
        if not room:
            raise ValueError(f'room {rno} not found in NKERP')
        if room.get('IsBlocked') or room.get('IsActive') is False:
            raise ValueError(f'room {rno} is blocked/inactive in NKERP')
        return room

    def check_capacity(self, room, need):
        over = capacity_problems(room, need, None if self.apply else self.planned_load[room['Id']])
        if over and not self.allow_over:
            clash = {o.split(':')[0] for o in over}
            there = sorted({x['TourReferenceNo'] for e in room.get('AccomodationRoomAllocatedDatesNew') or []
                            for x in e.get('RoomAllocatedDates_Current') or []
                            if day(e['OccupiedDate']) in clash and x.get('TourReferenceNo')})
            if not self.apply and any(d in clash for d, _ in self.planned_load[room['Id']]):
                there.append('another tour planned in this run')
            raise ValueError(f'room already occupied by {", ".join(there) or "others"}: ' + '; '.join(over))
        return over

    def plan_load(self, room, pairs):
        for d, aid, infant in pairs:
            self.planned_load[room['Id']][(d, aid)] = infant

    # -- 1. deallocate
    def deallocate(self, removals, held_reason=None):
        for rm in removals:
            if self.stopped() or self.full():
                return
            p, nights = rm['person'], rm['nights']
            days_ = [n['day'] for n in nights]
            label = f"{rm['ref']} {rm['name']} (ITS {rm['its']}) {place(*rm['was'])}"
            kw = dict(ref=rm['ref'], its=rm['its'], name=rm['name'], arrival=rm['arrival'], sheet=None,
                      before=place(*rm['was']), nights=days_)
            entry = {'action': 'deallocate', 'group': label, 'people': [rm['name']], 'dates': days_,
                     'by': ['Sheet row now blank or deleted']}
            if held_reason:
                self.problem('deallocate', label, [rm['name']], held_reason, [('DEALLOCATE', kw)])
                continue
            if not self.apply:
                self.report['planned'].append(entry)
                continue
            body = dealloc_payload(nights)

            def check(ref=rm['ref'], its=rm['its'], want=set(days_), was=rm['was']):
                fresh = people_on_tour(self.c.current(ref), ref).get(its)
                left = [n['day'] for n in (fresh['nights'] if fresh else [])
                        if n['day'] in want and (n['building'], n['room']) == was]
                return left, len(want) - len(left)
            status, detail = commit(lambda b=body: self.c.deallocate(b), check)
            self.rcache.clear()
            self.outcome(entry, status, detail, [('DEALLOCATE', dict(kw, after='' if status == 'done' else place(*rm['was'])))])

    # -- 2. reallocate
    def reallocate(self, moves, state):
        groups = defaultdict(list)
        for mv in moves:
            groups[mv['ref'], mv['building'], mv['room']].append(mv)
        for (ref, bname, rno), mvs in sorted(groups.items(), key=lambda kv: (len(kv[1]), kv[0]) if self.limit else kv[0]):
            if self.stopped() or self.full():
                return
            label = f'{ref} {place(bname, rno)}'
            names = [mv['person']['name'] for mv in mvs]
            days_ = sorted({n['day'] for mv in mvs for n in mv['nights']})
            rows = [('REALLOCATE', dict(ref=ref, its=mv['person']['its'], name=mv['person']['name'],
                                        arrival=state.get((ref, mv['person']['its']), {}).get('arrival', ''),
                                        sheet=(bname, rno), before=', '.join(mv['from']),
                                        nights=[n['day'] for n in mv['nights']])) for mv in mvs]
            try:
                if self.props is None:
                    self.props = self.c.properties()
                if bname not in self.props:
                    raise ValueError(f'building {bname.title()} not found in NKERP Najaf properties')
                pid = self.props[bname]
                tids = sorted({mv['person']['tour_id'] for mv in mvs if mv['person']['tour_id'] is not None})
                dates = [d + 'T00:00:00' for d in days_]
                room = self.room(pid, tids, dates, rno)
                need = defaultdict(int)
                for mv in mvs:
                    for n in mv['nights']:
                        need[n['day']] += 0 if n['entry'].get('IsInfant') else 1
                over = self.check_capacity(room, [(d, need[d]) for d in days_])
                body = realloc_payload(room, bname, mvs)
            except Exception as exc:
                self.problem('reallocate', label, names, str(exc), [(a, dict(kw, after=kw['before'])) for a, kw in rows])
                continue
            entry = {'action': 'reallocate', 'group': label, 'people': names, 'dates': days_,
                     'from': sorted({f for mv in mvs for f in mv['from']}), 'by': sorted({mv['how'] for mv in mvs}),
                     'over_capacity': over}
            if not self.apply:
                self.plan_load(room, [(n['day'], mv['person']['aid'], n['entry'].get('IsInfant'))
                                      for mv in mvs for n in mv['nights']])
                self.report['planned'].append(entry)
                continue

            def check(ref=ref, target=(bname, rno), want=[(mv['person']['its'], n['day']) for mv in mvs for n in mv['nights']]):
                fresh = people_on_tour(self.c.current(ref), ref)
                at = {(its, n['day']) for its, p in fresh.items() for n in p['nights'] if (n['building'], n['room']) == target}
                missing = [w for w in want if w not in at]
                return missing, len(want) - len(missing)
            status, detail = commit(lambda b=body: self.c.reallocate(b), check)
            self.rcache.clear()
            self.outcome(entry, status, detail,
                         [(a, dict(kw, after=place(bname, rno) if status == 'done' else '')) for a, kw in rows])

    # -- 3. allocate (unchanged rules)
    def allocate(self, items, state):
        groups = defaultdict(list)
        for it in items:
            groups[it['arrival'], it['ref'], it['building'], it['room']].append(it)
        order = sorted(groups.items())
        if self.limit:
            order = sorted(order, key=lambda kv: len(kv[1]))   # smallest groups first for a trial
        for (arrival, ref, bname, rno), its in order:
            if self.stopped() or self.full():
                return
            label = f'{arrival} {ref} {place(bname, rno)}'
            names = [it['app']['ApplicantName'].strip() for it in its]
            tids = sorted({it['app']['TourID'] for it in its})
            dates = sorted({d['ArrivalDate'] for it in its for d in it['dates']})
            rows = [('ALLOCATE', dict(ref=ref, its=norm(it['app'].get('ITSId')), name=it['app']['ApplicantName'].strip(),
                                      arrival=arrival, sheet=(bname, rno),
                                      nights=[day(d['ArrivalDate']) for d in it['dates']])) for it in its]
            try:
                key = (tuple(tids), tuple(dates))
                if key not in self.bcache:
                    self.bcache[key] = self.c.buildings(tids, dates)
                if bname not in self.bcache[key]:
                    raise ValueError(f'building {bname.title()} not offered in NKERP for this tour')
                pid = self.bcache[key][bname]
                room = self.room(pid, tids, dates, rno)
                body = payload(room, its)
                over = self.check_capacity(room, alloc_need(body))
            except Exception as exc:
                self.problem('allocate', label, names, str(exc), rows)
                continue
            entry = {'action': 'allocate', 'group': label, 'people': names, 'dates': [day(d) for d in dates],
                     'by': sorted({it['how'] for it in its}), 'over_capacity': over}
            if not self.apply:
                self.plan_load(room, [(day(d['ArrivalDate']), it['app']['ApplicantinTourId'], it['app']['IsInfant'])
                                      for it in its for d in it['dates']])
                self.report['planned'].append(entry)
                continue
            status, detail = commit(lambda b=body: self.c.save(b),
                                    lambda: persisted(self.c, pid, tids, dates, rno, its))
            self.rcache.clear()
            self.outcome(entry, status, detail,
                         [(a, dict(kw, after=place(bname, rno) if status == 'done' else '')) for a, kw in rows])


def run(apply=False, today=None, allow_over=False, out=None, limit=None, only=None, max_dealloc=MAX_DEALLOC,
        allow_mass_dealloc=False):
    today = today or datetime.now(LOCAL).date().isoformat()
    since = (date.fromisoformat(today) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    only = set(only or ('allocate', 'reallocate', 'deallocate'))
    c = Client(allow_write=apply)
    token = google_token()
    sheet = read_sheet(token)
    tab = history.Tab(SHEET_ID, token)
    mem = history.memory(tab.read(), since)
    hist_error = tab.ensure_writable() if apply else None
    apps = c.pending()
    R = Run(c, apply, today, allow_over, limit)
    rep = R.report

    items, notes, skipped = plan(sheet, apps, today)
    refs = sorted({r['ref'] for r in sheet if r['ref'] and r['arrival'] and r['arrival'] >= since}
                  | {ref for ref, _ in mem})
    current = {ref: people_on_tour(c.current(ref), ref) for ref in refs}
    sync = plan_sync(sheet, current, apps, mem, today)
    for k, v in sync['notes'].items():
        notes[k].extend(v)
    rep['notes'], rep['skipped'] = dict(notes), dict(skipped)

    held = None
    if hist_error:
        held = f'deallocation needs the Sync History tab: {hist_error}'
        rep['problems'].append({'action': 'history', 'group': 'Sync History', 'people': [], 'reason': hist_error})
    elif len({(rm['ref'], rm['its']) for rm in sync['removals']}) > max_dealloc and not allow_mass_dealloc:
        held = (f'{len(sync["removals"])} people to deallocate is more than {max_dealloc} in one run; held all. '
                'Check the Sheet wasn\'t cleared by mistake, then rerun with --allow-mass-deallocation if it is right.')
    elif len([r for r in sheet if r['its'] and r['room']]) < 10 and sync['removals']:
        held = 'the Sheet shows almost no rooms (fewer than 10); deallocation held in case the Sheet read went wrong'

    if 'deallocate' in only:
        R.deallocate(sync['removals'], held)
        for cl in sync['cleared']:
            R.log('CLEARED', 'recorded', cl['ref'], cl['its'], cl['name'], cl['arrival'], None,
                  before=place(*cl['was']), details=cl['details'])
    if 'reallocate' in only:
        R.reallocate(sync['moves'], sync['state'])
    if 'allocate' in only:
        R.allocate(items, sync['state'])

    # people whose Sheet room changed since the last run and who weren't acted on: remember what the Sheet says
    for (ref, its), st in sorted(sync['state'].items()):
        m = mem.get((ref, its))
        if st['arrival'] and st['arrival'] < since:
            continue                          # stays older than the lookback aren't remembered
        if (ref, its) not in R.acted and (not m or (m['building'], m['room']) != (st['building'], st['room'])):
            R.log('SEEN', 'recorded', ref, its, st['name'], st['arrival'], (st['building'], st['room']),
                  details=f"Sheet room by {st['how']}")
    if apply and not hist_error:
        run_at = datetime.now(LOCAL)
        for h in R.hist:
            h['Run At'], h['Run ID'] = run_at.strftime('%Y-%m-%d %H:%M'), run_at.strftime('%Y%m%d-%H%M%S')
        try:
            rep['history'] = {'rows_written': tab.append(R.hist)}
        except Exception as exc:
            rep['history'] = {'error': f'could not append to Sync History ({exc})'}
            rep['problems'].append({'action': 'history', 'group': 'Sync History', 'people': [],
                                    'reason': rep['history']['error']})
    else:
        rep['history'] = {'rows_planned': len(R.hist)} if not hist_error else {'error': hist_error}
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(json.dumps(rep, indent=1, ensure_ascii=False))
    return rep


def count(entries, action):
    return sum(1 for e in entries if e.get('action') == action)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Najaf room sync from the Sheet (allocate, reallocate, deallocate). '
                                            'Dry run unless --apply.')
    p.add_argument('--apply', action='store_true', help='write to NKERP and Sync History (default dry run)')
    p.add_argument('--today', help='YYYY-MM-DD start date (default: today, Asia/Baghdad)')
    p.add_argument('--only', help='comma list of allocate,reallocate,deallocate (default all three)')
    p.add_argument('--allow-over-capacity', action='store_true', help='only when the user explicitly says so')
    p.add_argument('--max-deallocations', type=int, default=MAX_DEALLOC,
                   help=f'hold all deallocations when more people than this (default {MAX_DEALLOC})')
    p.add_argument('--allow-mass-deallocation', action='store_true', help='only when the user explicitly says so')
    p.add_argument('--limit', type=int, help='only the first N write groups (trial run; allocation smallest first)')
    p.add_argument('--output', default='work/najaf-allocation-report.json')
    a = p.parse_args()
    only = [x.strip() for x in a.only.split(',')] if a.only else None
    if only and not set(only) <= {'allocate', 'reallocate', 'deallocate'}:
        p.error('--only takes allocate, reallocate, deallocate')
    rep = run(a.apply, a.today, a.allow_over_capacity, a.output, a.limit, only, a.max_deallocations,
              a.allow_mass_deallocation)
    print(json.dumps({'mode': rep['mode'], 'today': rep['today'],
                      'done': {k: count(rep['done'], k) for k in ('deallocate', 'reallocate', 'allocate')},
                      'planned': {k: count(rep['planned'], k) for k in ('deallocate', 'reallocate', 'allocate')},
                      'problems': len(rep['problems']), 'stopped': rep.get('stopped'),
                      'notes': {k: len(v) for k, v in rep['notes'].items()}, 'skipped': rep['skipped'],
                      'history': rep.get('history'), 'output': a.output}, indent=1))
    sys.exit(2 if rep.get('stopped') else 0)
