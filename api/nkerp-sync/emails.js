// Vercel Function: GET /api/nkerp-sync/emails. Najaf stays from today and their accommodation emails (read only).
// The engine is server/nkerp-sync/ (built into ../_lib by npm run build:api).
import { handleEmailList } from '../_lib/nkerp-sync.mjs';

export const config = { maxDuration: 60 };

export function GET(request) {
  return handleEmailList(request);
}
