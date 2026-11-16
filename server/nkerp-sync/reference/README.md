# Reference implementation (do not edit)

These are the `najaf-accommodation-allocation` skill's own scripts (`najaf_alloc.py`, `history.py`,
`credentials.py`), copied unchanged. The app does not run them. They are kept here as the specification
the TypeScript engine in `server/nkerp-sync/` was ported from, and `__tests__/parity.test.ts` runs them
side by side with the TypeScript engine on random scenarios and requires identical reports, Sync History
rows and NKERP payloads.

No credentials are stored here: `credentials.py` only reads environment variables, and the skill's
`references/` folder (with its keys) was not copied.

When the skill changes, copy the new scripts over these and run `npm run test:sync`: any behaviour the
TypeScript engine does not yet match shows up as a parity failure with the exact field that differs.
