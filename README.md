# Zaereen Accommodation & Google Sheets Reservation Manager

## Overview
This application streamlines reservation management and logistics for Zaereen accommodations. It acts as an intelligent assistant to parse booking details and organize them for seamless integration into our Google Sheets tracking workflows.



## Usage
1. Enter the required Gemini API Key to unlock the interface.
2. Paste raw booking details or administrative queries into the chat.
3. Copy the AI-formatted output directly into the master spreadsheet tracker.

## Sync to NKERP

The **Sync to NKERP** button (top bar on every screen) runs the Najaf accommodation allocation on the app's
server side (Vercel Functions, or the app's own server), with no external AI or Claude account involved. Each run brings NKERP's Najaf rooms in line with the
Google Sheet *Faiz Husaini Zaereen Accommodation (Saifee & Burhani)*, in this order:

1. **Deallocate** people an earlier run saw in the Sheet with a room whose row is now blank or deleted, and whom
   NKERP still has in that same room (tonight onward only).
2. **Reallocate** people NKERP has in a different building or room than the Sheet (tonight onward only).
3. **Allocate** people NKERP still lists as unallocated, for Sheet rows arriving today or later.

Every save is one NKERP call (emails off), confirmed by a fresh read and never retried. A save that cannot be
confirmed stops the run. Room capacity is checked night by night. More than 20 deallocations, or a Sheet that
looks empty, holds all deallocations. Applied runs are logged in the Sheet's **Sync History** tab, which is also
the sync's memory between runs (don't edit its rows). Karbala, other sub-venues and other tabs are never touched.

The **Sync** tab shows the live log, a **Needs you** list (each problem with what to do about it), what was
done, the run history, and an instruction box. Type what should happen in plain words, for example "preview
tomorrow", "only allocations", "why was Saifee 107 held?" or "the sheet is correct, allow the deallocations".
Safe requests run straight away. Anything that loosens a safety rule asks for confirmation first.

### Server configuration

| Secret | Purpose |
| --- | --- |
| `NKERP_LOGIN_ID`, `NKERP_PASSWORD` | NKERP account with the *Tour and Accomodation Admin* role |
| `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_SERVICE_ACCOUNT_FILE`) | Google service-account key. Share the Sheet with its `client_email` as **Editor** |
| `NKERP_SYNC_ACCESS_KEY` (optional) | Key staff enter once per device to use the sync. Without it there is no key: anyone who can open the app can run the sync |
| `GEMINI_API_KEY` (optional) | Lets the instruction box understand free-form phrasing. Without it, built-in rules are used |

The server needs outbound access to `to.najafkarbala.com`, `sheets.googleapis.com` and `oauth2.googleapis.com`.

### Hosting

- **Vercel** (the live app): the sync runs as Vercel Functions in `api/nkerp-sync/`. Add the secrets above in the
  Vercel project under **Settings → Environment Variables**, then redeploy. One sync can run for up to 5 minutes (the
  Hobby plan's limit). The engine starts no new save in the last 40 seconds, so the limit never cuts a save in half;
  if a run stops early, press Sync again to finish (a rerun is safe). Keep the Sync tab open while a sync runs.
- **Own server** (`npm run dev` / `npm start`, Google AI Studio, Cloud Run): `server.ts` serves the same API.

The functions run a pre-built copy of the engine (`api/_lib/nkerp-sync.mjs`). After changing anything in
`server/nkerp-sync/`, run `npm run build:api` and commit the result; `npm run test:sync` fails if it is out of date.

### Engine and tests

The engine lives in `server/nkerp-sync/`. It is a TypeScript port of the `najaf-accommodation-allocation` skill.
The skill's Python scripts are kept in `server/nkerp-sync/reference/` as the specification.

```bash
npm run test:sync
```

This runs the skill's full test suite (ported), HTTP integration tests, instruction-interpreter tests, and a
differential test. The differential test runs the TypeScript engine and the skill's Python code on hundreds of
random scenarios and requires identical reports, history rows and NKERP payloads (`PARITY_CASES=3000` for more).
