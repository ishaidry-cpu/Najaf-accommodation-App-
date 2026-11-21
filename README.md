# Najaf Accommodation

Run the app on the computer that holds the accommodation database. Use Node.js 24 or later.

```sh
npm install
cp .env.example .env
npm run dev
```

Set the NKERP account in `.env`, then open [http://127.0.0.1:3000](http://127.0.0.1:3000). For a production build, run `npm run build` followed by `NODE_ENV=production npm start`. The app stores changes in SQLite under `~/.local/share/najaf-accommodation` by default. Set `NAJAF_DATA_DIR` to use a different permanent directory. Working copies on the same computer use the same default database.

The server pulls Najaf applicant, stay, and room-allocation data from NKERP at startup and every minute while running. **Pull from NKERP** starts the same read-only refresh. A second request joins a pull already in progress. Profiles and stay dates come from the Najaf allocation search and tour accommodation plan. Current room assignments come from NKERP’s room-allocation records. NKERP’s allocated-room response supplies fewer profile fields than the applicant search, so previously saved values are preserved when the upstream field is absent.

The app keeps repeat trips separate by tour reference, guest, and arrival. Saves use the app database. The scheduled cleanup removes a stay and its sync history 72 hours after its departure time in Baghdad. A departure date without a time is retained through that date’s end before the 72 hours begin. Room inventory and settings persist independently. **Export room allocation** downloads the saved allocations and inventory as an Excel file.

**Sync to NKERP** still previews or applies deallocations, reallocations, and allocations from the saved app records using the existing Najaf allocation checks. The applied-run history lives in the app. Automatic pulls do not send allocation updates or emails.

## One-time migration for another installation

Stop the previous app. Export the live workbook as Excel. If the previous installation has a local `data/reservations.json` with app edits, provide its path to preserve app-only fields. The exporter abbreviates the grid tab name to meet Excel’s length limit.

```sh
npm run import:workbook -- /path/to/final-export.xlsx --legacy-reservations /path/to/old/reservations.json
```

Omit the legacy flag for a new installation. This command verifies the tabs and imports the grid, linked upgrade details, and allocation sync history in one transaction. The app derives its timeline from the saved bookings and seeds the same official inventory from its room definitions. Run the import against the same `NAJAF_DATA_DIR` as the new app. A successful import is recorded in the database, and repeating the same export returns its original result.
