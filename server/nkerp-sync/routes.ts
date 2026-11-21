/** Express adapter for the app’s local NKERP API. */
import express from 'express';
import { Readable } from 'stream';
import { dispatch, type HandlerDeps } from './handlers.js';

/** Express request -> web Request (the JSON body was already parsed by express.json()). */
export function toWebRequest(req: express.Request, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, String(v));
  }
  if (req.ip && !headers.has('x-forwarded-for')) headers.set('x-forwarded-for', req.ip);
  headers.delete('content-length');
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})) : undefined;
  return new Request(`http://localhost${req.originalUrl}`, { method: req.method, headers, body, signal });
}

/** web Response -> Express response, streaming the body (the run endpoint streams its log). */
export async function sendWebResponse(webRes: Response, res: express.Response): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  if (!webRes.body) {
    res.end();
    return;
  }
  res.flushHeaders();
  const nodeStream = Readable.fromWeb(webRes.body as any);
  res.on('close', () => nodeStream.destroy());       // browser left: cancels the web stream (stop after current save)
  nodeStream.on('error', () => res.end());
  nodeStream.pipe(res);
}

export function createNkerpSyncRouter(deps: HandlerDeps = {}): express.Router {
  const router = express.Router();
  router.all('/:name', async (req, res) => {
    try {
      const webReq = toWebRequest(req, new AbortController().signal);
      await sendWebResponse(await dispatch(req.params.name, webReq, deps), res);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: (err as Error).message });
      else res.end();
    }
  });
  return router;
}
