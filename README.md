# Najaf Accommodation

The hosted Worker serves both the web app and its API. A SQLite-backed Durable Object stores reservations, room inventory, settings, and sync history. The Worker talks directly to NKERP. A one-minute Cloudflare trigger runs the automatic pull and retention cleanup.

## Cloudflare deployment

From a Cloudflare-authenticated checkout use `npm run deploy:check`, then `npm run deploy`. Configure `NKERP_LOGIN_ID` and `NKERP_PASSWORD` as Worker secrets. The hosted app is publicly accessible and opens without a sign-in.

For the first deployment, temporarily set `NAJAF_IMPORT_KEY` to a separate random secret. Send the migrated database snapshot as JSON to `POST /api/admin/import` with that secret in the bearer header. The snapshot contains `reservations`, `rooms`, `history`, and `settings` from the Node app database. It may also contain `removed-stays`. The Worker accepts only the first import. Remove the import secret after verification.

## Optional local development

Use Node.js 24 or later.

```sh
npm install
cp .env.example .env
npm run dev
```

Set the NKERP account in `.env`, then open [http://127.0.0.1:3000](http://127.0.0.1:3000). For a production build, run `npm run build` followed by `NODE_ENV=production npm start`. The app stores changes in SQLite under `~/.local/share/najaf-accommodation` by default. Set `NAJAF_DATA_DIR` to use a different permanent directory. Working copies on the same computer use the same default database.

The app pulls Najaf applicant, stay, and room-allocation data from NKERP at startup and every minute while running. **Pull from NKERP** starts the same read-only refresh. A second request joins a pull already in progress. Profiles and stay dates come from the Najaf allocation search and tour accommodation plan. Current room assignments come from NKERP’s room-allocation records. NKERP’s allocated-room response supplies fewer profile fields than the applicant search, so previously saved values are preserved when the upstream field is absent.

The app keeps repeat trips separate by tour reference, guest, and arrival. Saves use the app database. The scheduled cleanup removes a stay and its sync history 72 hours after its departure time in Baghdad. A departure date without a time is retained through that date’s end before the 72 hours begin. Room inventory and settings persist independently. **Rooms → Add rooms** adds one room or a range of rooms to Burhani, Saifee or Badri with their beds, sleeping capacity, buffer, bed type, toilet, category, floor, features and notes. **Edit** on a room card changes those details later. New rooms are available straight away for allotment, switching, the timeline and the AI Planner. **Reset to 120 rooms** removes added rooms and restores the official specs. **Export room allocation** downloads the saved allocations and inventory as an Excel file.

**AI Planner** plans rooms for zaereen who have none yet, for the arrival dates you choose, using what it learns from the allocations saved in the app. Only one family shares a room; putting families together is a manual choice. A family is the group ID when there is one, otherwise the NKERP family number (F-1, F-2 … within a tour). Some tours give every zair their own family number; those zaereen are grouped by their shared HOF ID, and **Allot Room → Allot Entire Family** uses the same household. Family numbers that already hold several people are never merged through the HOF ID. Families stay together whenever one room can hold them, and the planner picks the room that leaves the fewest beds empty: an exact fit first, then a buffer bed, and only then a room with empty beds. Office and building habits only decide between rooms that fit equally well. A family no free room can hold is split into the two parts that leave the fewest beds empty. The summary shows the plan's empty beds. Starred zaereen always go to Burhani first; their remarks decide the exact room. Tours stay in one building, each office's usual buildings are preferred, and infants under 3 take no bed. Everyone in these hotels is Category A: zaereen shifted A→B are in external hotels and are left out, and anyone who doesn't fit can be shifted A→B from the planner. A zair NKERP lists twice on a tour is planned once. Change any room, split a family or untick tours, then **Refresh plan** to keep your changes and re-fit everyone else into the space left, and allocate in one save. Nothing goes to NKERP until you run **Sync to NKERP**. Run `npm run test:planner` for its tests.

**Sync to NKERP** still previews or applies deallocations, reallocations, and allocations from the saved app records using the existing Najaf allocation checks. The applied-run history lives in the app. Automatic pulls do not send allocation updates or emails.

## One-time migration for another installation

Stop the previous app. Export the live workbook as Excel. If the previous installation has a local `data/reservations.json` with app edits, provide its path to preserve app-only fields. The exporter abbreviates the grid tab name to meet Excel’s length limit.

```sh
npm run import:workbook -- /path/to/final-export.xlsx --legacy-reservations /path/to/old/reservations.json
```

Omit the legacy flag for a new installation. This command verifies the tabs and imports the grid, linked upgrade details, and allocation sync history in one transaction. The app derives its timeline from the saved bookings and seeds the same official inventory from its room definitions. Run the import against the same `NAJAF_DATA_DIR` as the new app. A successful import is recorded in the database, and repeating the same export returns its original result.
