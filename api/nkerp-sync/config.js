// Vercel Function: GET /api/nkerp-sync/config. The engine is server/nkerp-sync/ (built into ../_lib by npm run build:api).
import { handleConfig } from '../_lib/nkerp-sync.mjs';

export function GET() {
  return handleConfig();
}
