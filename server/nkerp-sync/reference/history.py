"""The Sheet's 'Sync History' tab: a log of every applied run, and the memory of what earlier runs saw.

Each row is one person on one tour. The latest row per (Tour ID, ITS) that carries state gives the room the
Sheet last showed for that person:
  ALLOCATE / REALLOCATE / SEEN rows (any result)        -> Sheet Building + Sheet Room as seen in that run
  DEALLOCATE (result done) / CLEARED (result recorded)   -> no room (the Sheet had cleared it)
A DEALLOCATE that was refused, held or unconfirmed carries no state, so the next run tries again.

This module only ever writes to the 'Sync History' tab. Python 3.9+, standard library.
"""
import json
import re
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, build_opener

TAB = 'Sync History'
COLUMNS = ['Run At', 'Action', 'Result', 'Tour ID', 'ITS', 'Name', 'Arrival', 'Sheet Building', 'Sheet Room',
           'NKERP Before', 'NKERP After', 'Nights', 'Details', 'Run ID']
STATEFUL = {'ALLOCATE', 'REALLOCATE', 'SEEN'}
CLEARING = {('DEALLOCATE', 'done'), ('CLEARED', 'recorded')}


def _norm(s):
    return re.sub(r'\s+', ' ', str(s if s is not None else '')).strip().upper()


def _range(a1):
    return quote(f"'{TAB}'!{a1}", safe='')


class Tab:
    def __init__(self, sheet_id, token):
        self.base = f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}'
        self.token = token

    def _call(self, url, body=None, method=None):
        req = Request(url, data=None if body is None else json.dumps(body).encode(), method=method,
                      headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        with build_opener().open(req, timeout=120) as r:
            return json.load(r)

    def read(self):
        """All rows as dicts keyed by column name; [] when the tab doesn't exist yet."""
        try:
            vals = self._call(f'{self.base}/values/{_range("A:N")}?valueRenderOption=FORMATTED_VALUE').get('values', [])
        except HTTPError as e:
            if e.code == 400:            # "Unable to parse range": no such tab
                return []
            raise
        if not vals:
            return []
        head = [str(h).strip() for h in vals[0]]
        return [{head[i]: (row[i] if i < len(row) else '') for i in range(len(head))} for row in vals[1:]]

    def ensure_writable(self):
        """Create the tab if missing, then rewrite its header row (a harmless write that proves edit access).
        Returns None when writable, else the reason."""
        try:
            meta = self._call(f'{self.base}?fields=sheets.properties.title')
            if TAB not in [s['properties']['title'] for s in meta.get('sheets', [])]:
                self._call(f'{self.base}:batchUpdate', {'requests': [{'addSheet': {'properties': {
                    'title': TAB, 'gridProperties': {'rowCount': 2000, 'columnCount': len(COLUMNS),
                                                     'frozenRowCount': 1}}}}]})
            self._call(f'{self.base}/values/{_range("A1:N1")}?valueInputOption=RAW', {'values': [COLUMNS]}, 'PUT')
            return None
        except HTTPError as e:
            if e.code == 403:
                return ('the skill\'s Google service account can only view the Sheet; share the Sheet with it as '
                        'Editor so runs can write the Sync History tab')
            return f'Sync History tab not writable (HTTP {e.code})'

    def append(self, rows):
        if not rows:
            return 0
        body = {'values': [[str(r.get(c, '') if r.get(c) is not None else '') for c in COLUMNS] for r in rows]}
        self._call(f'{self.base}/values/{_range("A:N")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
                   body)
        return len(rows)


def memory(rows, since):
    """(TOUR ID, ITS) -> {'building', 'room', 'arrival', 'name'}: the room the Sheet last showed for each person
    in earlier runs ('' when it was cleared). Only stays arriving on or after `since` (ISO date) are kept."""
    mem = {}
    for r in rows:
        act, res = _norm(r.get('Action')), str(r.get('Result') or '').strip().lower()
        if act not in STATEFUL and (act, res) not in CLEARING:
            continue
        key = (_norm(r.get('Tour ID')), _norm(r.get('ITS')))
        if not all(key):
            continue
        mem[key] = {'building': _norm(r.get('Sheet Building')), 'room': _norm(r.get('Sheet Room')),
                    'arrival': str(r.get('Arrival') or '').strip()[:10], 'name': str(r.get('Name') or '').strip()}
    return {k: v for k, v in mem.items() if not v['arrival'] or v['arrival'] >= since}
