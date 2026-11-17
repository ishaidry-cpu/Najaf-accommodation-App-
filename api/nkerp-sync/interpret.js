// Vercel Function: POST /api/nkerp-sync/interpret. The engine is server/nkerp-sync/ (built into ../_lib by npm run build:api).
import { handleInterpret } from '../_lib/nkerp-sync.mjs';

export const config = { maxDuration: 60 };

export function POST(request) {
  return handleInterpret(request);
}
