// Vercel Function: GET /api/nkerp-sync/history. The engine is server/nkerp-sync/ (built into ../_lib by npm run build:api).
import { handleHistory } from '../_lib/nkerp-sync.mjs';

export const config = { maxDuration: 60 };

export function GET(request) {
  return handleHistory(request);
}
