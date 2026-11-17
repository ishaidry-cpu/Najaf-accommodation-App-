// Vercel Function: POST /api/nkerp-sync/run. The engine is server/nkerp-sync/ (built into ../_lib by npm run build:api).
// A full sync reads every tour from NKERP and can take several minutes: allow the plan's maximum. The engine
// starts no new save in the last 40 seconds, so the limit never cuts a save in half.
import { handleRun } from '../_lib/nkerp-sync.mjs';

export const config = { maxDuration: 300 };

export function POST(request) {
  return handleRun(request, { maxSeconds: 300 });
}
