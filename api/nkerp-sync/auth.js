// Vercel Function: POST /api/nkerp-sync/auth. The engine is server/nkerp-sync/ (built into ../_lib by npm run build:api).
import { handleAuth } from '../_lib/nkerp-sync.mjs';

export function POST(request) {
  return handleAuth(request);
}
