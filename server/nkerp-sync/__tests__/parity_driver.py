"""Runs the skill's reference implementation (../reference/najaf_alloc.py) on scenarios from stdin and prints
what it did, so __tests__/parity.test.ts can diff it against the TypeScript engine.

Input: JSON list of scenarios {sheet, apps, occ, mode, capacity, history, hist_error, options}.
Output: JSON list of {report, writes, appended} (Run At / Run ID removed: they are wall-clock stamps).
The fake NKERP below is the same as __tests__/fakes.ts (deterministic room-night ids).
"""
import json
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'reference'))
import najaf_alloc as m  # noqa: E402

ROOMS = {('SAIFEE', '107'): 1, ('SAIFEE', '108'): 2, ('BURHANI', '201'): 3}
PIDS = {'SAIFEE': 5, 'BURHANI': 6}


class Timeout(Exception):
    pass


Timeout.__name__ = 'TimeoutError'


class FakeNKERP:
    def __init__(self, apps, mode, capacity, occ):
        self.apps, self.mode, self.capacity, self.writes = apps, mode, capacity, []
        self.occ = [tuple(o) for o in occ]
        self.ids = {}

    def _mode(self):
        k = len(self.writes) - 1
        return self.mode[k] if isinstance(self.mode, list) else self.mode

    def _finish(self, mode):
        if mode.startswith('timeout'):
            raise Timeout()
        if mode == 'refused':
            raise m.Rejected('NKERP refused save: room locked')
        return {'ReturnStatus': True}

    def _row_id(self, b, rno, d):
        k = (b, rno, d)
        if k not in self.ids:
            self.ids[k] = 1000 + len(self.ids)
        return self.ids[k]

    def pending(self):
        return self.apps

    def buildings(self, tids, dates):
        return dict(PIDS)

    def properties(self):
        return dict(PIDS)

    def rooms(self, pid, tids, dates):
        b = next(k for k, v in PIDS.items() if v == pid)
        out = {}
        for (bb, rno), rid in ROOMS.items():
            if bb != b:
                continue
            per_day = {}
            for (ob, orr, d, aid, its, ref) in self.occ:
                if (ob, orr) == (bb, rno):
                    per_day.setdefault(d, []).append({'ApplicantId': aid, 'IsInfant': False, 'TourReferenceNo': ref})
            out[rno] = {'Id': rid, 'RoomNumber': rno, 'TotalCapacity': self.capacity, 'PropertyName': b.title(),
                        'AccomodationRoomAllocatedDatesNew': [{'OccupiedDate': d + 'T00:00:00', 'IsActive': True,
                                                               'RoomAllocatedDates_Current': xs} for d, xs in per_day.items()]}
        return out

    def current(self, ref):
        rows = {}
        for (b, rno, d, aid, its, r) in self.occ:
            if r != ref:
                continue
            rr = rows.setdefault((b, rno, d), {'Id': self._row_id(b, rno, d), 'OccupiedDate': d + 'T00:00:00',
                                               'PropertyName': b.title(), 'RoomNo': rno, 'RoomDetailId': ROOMS[b, rno],
                                               'PropertyId': PIDS[b], 'RoomAllocatedDates_Current': []})
            rr['RoomAllocatedDates_Current'].append({'ApplicantId': aid, 'AppicantITSId': its, 'ApplicantName': f'P{aid}',
                                                     'TourReferenceNo': r, 'TourId': 1, 'IsInfant': False, 'Family': ''})
        return list(rows.values())

    def save(self, body):
        self.writes.append(['allocate', json.loads(json.dumps(body))])
        mode = self._mode()
        if mode in ('ok', 'timeout_landed'):
            rid = body['lstAccomodationRoomAllocatedDates'][0]['RoomDetailId']
            b, rno = next(k for k, v in ROOMS.items() if v == rid)
            for e in body['lstAccomodationRoomAllocatedDates']:
                for x in e['RoomAllocatedDates_Current']:
                    self.occ.append((b, rno, e['OccupiedDate'][:10], x['ApplicantId'], '?', '?'))
        return self._finish(mode)

    def reallocate(self, body):
        self.writes.append(['reallocate', json.loads(json.dumps(body))])
        mode = self._mode()
        if mode in ('ok', 'timeout_landed'):
            for e in body['DeallocateList']:
                b, rno = next(k for k, v in ROOMS.items() if v == e['RoomDetailId'])
                for x in e['RoomAllocatedDates_Current']:
                    d = e['OccupiedDate'][:10]
                    self.occ = [o for o in self.occ if not (o[3] == x['ApplicantId'] and o[2] == d)]
                    self.occ.append((b, rno, d, x['ApplicantId'], x['AppicantITSId'], x['TourReferenceNo']))
        return self._finish(mode)

    def deallocate(self, body):
        self.writes.append(['deallocate', json.loads(json.dumps(body))])
        mode = self._mode()
        if mode in ('ok', 'timeout_landed'):
            for e in body['DeallocateList']:
                for x in e['RoomAllocatedDates_Current']:
                    self.occ = [o for o in self.occ if not (o[3] == x['ApplicantId'] and o[2] == e['OccupiedDate'][:10])]
        return self._finish(mode)


class FakeTab:
    def __init__(self, rows, error):
        self.rows, self.error, self.appended = rows, error, []

    def read(self):
        return self.rows

    def ensure_writable(self):
        return self.error

    def append(self, rows):
        self.appended.extend(rows)
        return len(rows)


def one(sc):
    fake = FakeNKERP(sc['apps'], sc['mode'], sc['capacity'], sc['occ'])
    tab = FakeTab(sc['history'], sc.get('hist_error'))
    o = sc['options']
    with mock.patch.object(m, 'google_token', return_value='t'), \
            mock.patch.object(m, 'read_sheet', return_value=sc['sheet']), \
            mock.patch.object(m.history, 'Tab', return_value=tab), \
            mock.patch.object(m, 'Client', return_value=fake):
        try:
            rep = m.run(apply=o['apply'], today=o['today'], allow_over=o.get('allowOverCapacity', False),
                        limit=o.get('limit'), only=o.get('only'), max_dealloc=o.get('maxDeallocations', m.MAX_DEALLOC),
                        allow_mass_dealloc=o.get('allowMassDeallocation', False))
        except Exception as exc:  # noqa: BLE001
            return {'error': f'{type(exc).__name__}: {exc}'}
    for h in tab.appended:
        h.pop('Run At', None)
        h.pop('Run ID', None)
    return {'report': rep, 'writes': fake.writes, 'appended': tab.appended}


if __name__ == '__main__':
    scenarios = json.load(sys.stdin)
    json.dump([one(sc) for sc in scenarios], sys.stdout, ensure_ascii=False)
