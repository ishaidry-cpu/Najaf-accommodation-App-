// Vercel Function: POST /api/nkerp-sync/emails-send. Sends the chosen Najaf accommodation emails one at a time and
// streams the outcome. The engine is server/nkerp-sync/ (built into ../_lib by npm run build:api).
import { handleEmailSend } from '../_lib/nkerp-sync.mjs';

export const config = { maxDuration: 300 };

export function POST(request) {
  return handleEmailSend(request, { maxSeconds: 300 });
}
